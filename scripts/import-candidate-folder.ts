/**
 * Load one role folder from the recruitment archive: a person per subfolder,
 * each with a CV and the documents behind it.
 *
 *   npx tsx --conditions=react-server scripts/import-candidate-folder.ts "<role folder>"
 *       [--department <slug>] [--include id_document,contract] [--only "<person folder>"]
 *       [--hold "<folder>,<folder>"] [--overrides fixes.json] [--dump <dir>] [--slice 0:20]
 *       [--as <email>] [--apply]
 *
 * Dry run is the default: it reads every CV, prints what it would create,
 * attach and leave behind, and writes nothing. --apply needs --as, so
 * created_by names a real person.
 *
 * Per person folder it picks one CV (see cv-folder-import.ts for how), reads it
 * with the same reader the upload page uses, and builds the record through the
 * same two mappings the form saves through, so an imported profile is exactly
 * what uploading that CV by hand would have made. Certificates and
 * qualifications go on the person's file as attachments. ID copies and consent
 * forms are held back unless --include names them; payslips and background
 * checks are never loaded.
 *
 * It refuses to guess. A record is only created when the name the CV gives is
 * the name on the folder; anything else is listed for a person to settle.
 * Somebody already on file (same email, phone or name) is never created again
 * and their record is never changed: only documents they do not have yet are
 * added. Run twice, the second run does nothing.
 *
 * --overrides is a JSON object keyed by person folder, for what a check of the
 * record against the document turned up: {"fields": {...}} is laid over what
 * the reader produced, {"skip": "reason"} leaves the person out, and
 * {"accept_name": true} settles a name the reader got differently, {"cv": path}
 * names the CV, and {"attach": {path: "certificate"}} loads a certificate or
 * qualification whose file name does not say what it is, and {"exclude": [path]}
 * leaves a file out (another person's document filed in the folder). It carries
 * personal details, so it stays out of the repo. --dump writes each record and
 * the text it was read from to a folder, for that check; keep it out of the
 * repo too.
 *
 * AI extraction runs only if GROQ_API_KEY is in the environment. It is not
 * read from .env.local here, so by default nothing leaves this machine.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { planExtraction, extractFromPlan } from "@/lib/extraction";
import { tippParsedFully } from "@/lib/extraction/local-parser";
import { fieldsFromExtraction } from "@/app/(app)/candidates/cv-fields";
import { toCandidateColumns } from "@/lib/candidate-columns";
import type { CandidateFormFields } from "@/app/(app)/candidates/actions";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { deriveCategories } from "@/lib/resource-categories";
import {
  attachmentContentType,
  attachmentStoragePath,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/candidate-attachments";
import {
  planPersonFiles,
  titleFromFilename,
  findKnownPerson,
  withoutAgencyContact,
  recordChecks,
  sameName,
  READABLE_CV_EXTENSIONS,
  type ArchiveFile,
  type ArchiveFileKind,
  type KnownPerson,
} from "@/lib/cv-folder-import";
import type { CandidateAttachmentKind } from "@/lib/supabase/database.types";
import { getItemByPath, uploadFile } from "@/lib/sharepoint/graph";
import { libraryRelativePath } from "@/lib/sharepoint/paths";

const BUCKET = "cvs";

/**
 * Where a file ends up. With SharePoint configured (MS_TENANT_ID,
 * MS_CLIENT_ID, MS_CLIENT_SECRET and SHAREPOINT_DRIVE_ID in .env.local), a
 * file that already sits in the synced library is linked, not copied; a file
 * that is not in the library (a staged zip's contents, a converted scan) is
 * uploaded once to "Imported (system)/<role>/<person>/" in the library and
 * linked. Without SharePoint the file is copied into the cvs bucket as before.
 */
type Placed = { kind: "drive"; driveId: string; itemId: string } | { kind: "storage"; path: string };
const SYSTEM_FOLDER = "Imported (system)";

function sharePointConfig(env: Record<string, string>) {
  for (const k of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "SHAREPOINT_DRIVE_ID"]) {
    if (env[k] && process.env[k] === undefined) process.env[k] = env[k];
  }
  if (!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.SHAREPOINT_DRIVE_ID)) return null;
  const libraryRoot =
    env.SHAREPOINT_LIBRARY_ROOT || path.join(os.homedir(), "TIPP FOCUS HOLDINGS (PTY) LTD", "Resourcing - Candidate Database");
  return { driveId: env.SHAREPOINT_DRIVE_ID, libraryRoot };
}

/**
 * LibreOffice turns an old Word .doc into a .docx the reader and the bucket
 * both take. The copy goes in a temporary folder; the archive is not touched.
 */
const SOFFICE = ["C:/Program Files/LibreOffice/program/soffice.exe", "/usr/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"].find((p) =>
  fs.existsSync(p),
);
const converted = new Map<string, string>();
function docAsDocx(abs: string): string | null {
  if (!SOFFICE) return null;
  const hit = converted.get(abs);
  if (hit) return hit;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "tipp-doc-"));
  const run = spawnSync(SOFFICE, ["--headless", "--convert-to", "docx", "--outdir", out, abs], { timeout: 120_000 });
  const docx = path.join(out, path.basename(abs).replace(/\.doc$/i, ".docx"));
  if (run.status !== 0 || !fs.existsSync(docx)) return null;
  converted.set(abs, docx);
  return docx;
}

/** Folders inside a role folder that hold files, not a person. */
const NOT_A_PERSON = /^(original cvs?|qualifications?|format+ed cvs?|cvs?|archive|old|templates?)$/i;

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

interface Override {
  fields?: Partial<CandidateFormFields>;
  skip?: string;
  accept_name?: boolean;
  /** The CV's path within the person's folder, when its name does not say it is one. */
  cv?: string;
  /** Files whose names do not say what they are, by path within the folder: certificate or qualification. */
  attach?: Record<string, "certificate" | "qualification">;
  /** Files to leave out, by path within the folder, e.g. another person's certificate filed here. */
  exclude?: string[];
}

function readEnv(): Record<string, string> {
  const file = path.resolve(".env.local");
  if (!fs.existsSync(file)) {
    console.error("No .env.local found. Run this from the repo root.");
    process.exit(1);
  }
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

function walk(root: string, dir = root): ArchiveFile[] {
  const out: ArchiveFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(root, full));
    else {
      const stat = fs.statSync(full);
      out.push({
        rel: path.relative(root, full).split(path.sep).join("/"),
        name: entry.name,
        ext: path.extname(entry.name).toLowerCase(),
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs / 1000),
      });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * The system never shows an em dash, so one copied out of a CV becomes a
 * spaced hyphen on the way in. Everything else is kept as the document wrote it.
 */
function noEmDashes<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\s*—\s*/g, " - ") as T;
  if (Array.isArray(value)) return value.map(noEmDashes) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, noEmDashes(v)])) as T;
  }
  return value;
}

/**
 * Postgres text cannot hold a NUL character, and some PDFs put one where a
 * ligature ("ffi", "fl") was, so the whole insert fails. The NUL carries no
 * meaning, so it is dropped.
 */
function withoutNul<T>(value: T): T {
  if (typeof value === "string") return value.replace(/\u0000/g, "") as T;
  if (Array.isArray(value)) return value.map(withoutNul) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutNul(v)])) as T;
  }
  return value;
}

const sha = (buffer: Buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

interface PersonPlan {
  folder: string;
  /** Why nothing is created for this folder, when nothing is. */
  hold: string | null;
  /** The folder earlier in this run that holds the same person, when there is one. */
  twinOf?: string;
  /** The person already on file, when there is one. */
  known: { person: KnownPerson; by: string } | null;
  fields: CandidateFormFields | null;
  cv: ArchiveFile | null;
  engine: string;
  attach: { file: ArchiveFile; kind: CandidateAttachmentKind; title: string }[];
  left: { file: ArchiveFile; reason: string }[];
  /** The CV text, for the checks. */
  rawText?: string;
}

async function main() {
  const root = process.argv[2];
  if (!root || root.startsWith("--") || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error('usage: npx tsx --conditions=react-server scripts/import-candidate-folder.ts "<role folder>" [--as <email>] [--apply]');
    process.exit(1);
  }
  const apply = has("apply");
  const operatorEmail = flag("as");
  if (apply && !operatorEmail) {
    console.error("--apply needs --as <email>, so created_by names a real person.");
    process.exit(1);
  }
  const include = (flag("include") ?? "").split(",").map((s) => s.trim()).filter(Boolean) as ArchiveFileKind[];
  const only = flag("only");
  // --slice 0:20 takes the first twenty subfolders in name order, so a large
  // role folder can be checked and loaded in batches.
  const [sliceStart, sliceEnd] = (flag("slice") ?? ":").split(":").map((s) => (s.trim() === "" ? undefined : Number(s)));
  const alsoHold = new Set((flag("hold") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const dumpDir = flag("dump");
  const overridesFile = flag("overrides");
  const overrides: Record<string, Override> = overridesFile ? JSON.parse(fs.readFileSync(overridesFile, "utf8")) : {};
  const departmentSlug = flag("department") ?? "resourcing";
  const roleFolder = path.basename(path.resolve(root));

  const env = readEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const sp = sharePointConfig(env);
  console.log(sp ? `Files: linked in SharePoint (library ${sp.libraryRoot})` : "Files: copied into the cvs bucket (SharePoint is not configured)");

  /** Link a file in the library, upload it there if it is not in it, or copy it to the bucket without SharePoint. */
  async function place(absPath: string, name: string, personFolder: string, prefix: "candidates" | "attachments", ext: string): Promise<Placed> {
    if (sp) {
      const rel = libraryRelativePath(sp.libraryRoot, absPath);
      if (rel) {
        const item = await getItemByPath(sp.driveId, rel);
        if (item) return { kind: "drive", driveId: sp.driveId, itemId: item.id };
        throw new Error(`"${rel}" is not in SharePoint yet (still syncing?)`);
      }
      const item = await uploadFile(sp.driveId, `${SYSTEM_FOLDER}/${roleFolder}/${personFolder}`, name, fs.readFileSync(absPath),
                                    MIME[ext] ?? attachmentContentType(name));
      return { kind: "drive", driveId: sp.driveId, itemId: item.id };
    }
    // Bucket copy: an old Word .doc CV goes in as the .docx the bucket accepts.
    const docx = prefix === "candidates" && ext === ".doc" ? docAsDocx(absPath) : null;
    const storeExt = docx ? ".docx" : ext;
    const objectPath = prefix === "candidates" ? `candidates/${crypto.randomUUID()}${storeExt}` : attachmentStoragePath(crypto.randomUUID(), name);
    const { error } = await db.storage.from(BUCKET).upload(objectPath, fs.readFileSync(docx ?? absPath), {
      contentType: prefix === "candidates" ? MIME[storeExt] : attachmentContentType(name),
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return { kind: "storage", path: objectPath };
  }

  let operator: { id: string; email: string; full_name: string } | null = null;
  if (operatorEmail) {
    const { data: profiles } = await db.from("profiles").select("id, email, full_name").eq("email", operatorEmail);
    if (!profiles || profiles.length !== 1) {
      console.error(`--as ${operatorEmail} matched ${profiles?.length ?? 0} profiles. It has to match exactly one.`);
      process.exit(1);
    }
    operator = profiles[0];
  }

  const { data: departments } = await db.from("departments").select("id, name, slug");
  const department = (departments ?? []).find((d) => d.slug === departmentSlug);
  if (!department) {
    console.error(`No department with slug "${departmentSlug}". There are: ${(departments ?? []).map((d) => d.slug).join(", ")}`);
    process.exit(1);
  }

  const { data: known, error: knownError } = await fetchAll<KnownPerson>((from, to) =>
    db.from("candidates").select("id, full_name, email, phone").order("id").range(from, to),
  );
  if (knownError) {
    console.error(`Could not read candidates: ${knownError}`);
    process.exit(1);
  }

  const folders = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !only || n === only)
    .sort((a, b) => a.localeCompare(b))
    .slice(sliceStart, sliceEnd);
  const loose = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);

  const plans: PersonPlan[] = [];
  const heldFolders: { folder: string; files: number }[] = [];
  // People this run will create, so two folders for one person make one record.
  const planned: KnownPerson[] = [];

  for (const folder of folders) {
    const dir = path.join(root, folder);
    const files = walk(dir);
    if (NOT_A_PERSON.test(folder.trim()) || alsoHold.has(folder.trim().toLowerCase())) {
      heldFolders.push({ folder, files: files.length });
      continue;
    }
    const override = overrides[folder] ?? {};
    const decided = planPersonFiles(files, { include, personName: folder }).map((d) => {
      // A correction can name the CV when its file name does not say so.
      if (override.exclude?.includes(d.file.rel)) return { ...d, decision: { action: "skip" as const, reason: "left out by a correction" } };
      const as = override.attach?.[d.file.rel];
      if (as) return { ...d, decision: { action: "attach" as const, kind: as, title: titleFromFilename(d.file.name) } };
      if (!override.cv) return d;
      if (d.file.rel === override.cv) return { ...d, decision: { action: "primary_cv" as const } };
      if (d.decision.action === "primary_cv") return { ...d, decision: { action: "skip" as const, reason: "not the CV" } };
      return d;
    });
    for (const rel of [...Object.keys(override.attach ?? {}), ...(override.exclude ?? [])]) {
      if (!files.some((f) => f.rel === rel)) {
        console.error(`${folder}: the correction names "${rel}", but there is no such file`);
        process.exit(1);
      }
    }
    if (override.cv && !decided.some((d) => d.decision.action === "primary_cv")) {
      console.error(`${folder}: the correction names "${override.cv}" as the CV, but there is no such file`);
      process.exit(1);
    }
    const cv = decided.find((d) => d.decision.action === "primary_cv")?.file ?? null;
    const plan: PersonPlan = {
      folder,
      hold: null,
      known: null,
      fields: null,
      cv,
      engine: "",
      attach: [],
      left: [],
    };

    // The same bytes under three names are one document.
    const seenContent = new Set<string>();
    for (const d of decided) {
      if (d.decision.action === "skip") plan.left.push({ file: d.file, reason: d.decision.reason });
      if (d.decision.action !== "attach") continue;
      if (d.file.size > MAX_ATTACHMENT_BYTES) {
        plan.left.push({ file: d.file, reason: "larger than the 10 MB an attachment may be" });
        continue;
      }
      const digest = sha(fs.readFileSync(path.join(dir, d.file.rel)));
      if (seenContent.has(digest)) {
        plan.left.push({ file: d.file, reason: "the same document as another file in this folder" });
        continue;
      }
      seenContent.add(digest);
      plan.attach.push({ file: d.file, kind: d.decision.kind, title: d.decision.title });
    }

    let extractedName: string | null = null;
    if (override.skip) {
      plan.hold = override.skip;
    } else if (!cv) {
      plan.hold = "no CV in the folder";
    } else if (!READABLE_CV_EXTENSIONS.has(cv.ext) && !(cv.ext === ".doc" && docAsDocx(path.join(dir, cv.rel)))) {
      plan.hold = `the only CV is a ${cv.ext} file, which cannot be read; save it as .docx or PDF`;
    } else {
      const docx = cv.ext === ".doc" ? docAsDocx(path.join(dir, cv.rel)) : null;
      const readExt = docx ? ".docx" : cv.ext;
      const readName = docx ? path.basename(docx) : cv.name;
      const bytes = fs.readFileSync(docx ?? path.join(dir, cv.rel));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const extraction = await planExtraction(buffer, MIME[readExt], readName);
      const result = await extractFromPlan(extraction, readName);
      const template = extraction.isTipp ? (tippParsedFully(extraction.local) ? "TiPP template, read in full" : "TiPP template, partly read") : "not the template";
      plan.engine = `${result.engine}, ${template}${docx ? ", converted from .doc" : ""}`;
      const fields: CandidateFormFields = withoutAgencyContact(
        noEmDashes({
          ...fieldsFromExtraction(result, { department_ids: [department.id] }),
          ...(override.fields ?? {}),
        }),
      );
      // The practice areas come from the roles and skills, so they are worked
      // out again once a correction has changed those.
      if (override.fields && !override.fields.resource_categories) {
        fields.resource_categories = deriveCategories({
          skills: fields.skills,
          technical_skills: fields.technical_skills,
          current_role: fields.current_role,
          additional_roles: fields.additional_roles,
        });
      }
      extractedName = fields.full_name || null;
      plan.rawText = result.raw_text;
      if (dumpDir) {
        fs.mkdirSync(dumpDir, { recursive: true });
        fs.writeFileSync(
          path.join(dumpDir, `${sanitizeFilename(folder)}.json`),
          JSON.stringify({ folder, cv: cv.rel, engine: plan.engine, fields, raw_text: result.raw_text }, null, 2),
        );
      }
      if (result.no_text_found) {
        plan.hold = "the CV is a scan with no text in it";
      } else if (!fields.full_name.trim()) {
        plan.hold = "the reader found no name in the CV";
      } else if (!sameName(fields.full_name, folder) && !override.accept_name) {
        plan.hold = `the CV gives the name "${fields.full_name}", which is not the folder's`;
      } else {
        plan.fields = fields;
      }
    }

    // Somebody on file is found by what the CV says, or by the folder's name
    // when there is no CV to say anything.
    const probe = {
      full_name: plan.fields?.full_name ?? extractedName ?? folder,
      email: plan.fields?.email ?? null,
      phone: plan.fields?.phone ?? null,
    };
    plan.known = findKnownPerson(probe, known) ?? findKnownPerson({ full_name: folder, email: null, phone: null }, known);
    // A person filed under two folders in one run is one record: the second
    // folder's documents go on the record the first one creates.
    if (!plan.known) {
      const twin = findKnownPerson(probe, planned) ?? findKnownPerson({ full_name: folder, email: null, phone: null }, planned);
      if (twin) {
        plan.twinOf = twin.person.id;
        plan.fields = null;
      } else if (plan.fields) planned.push({ id: folder, ...probe });
    }
    plans.push(plan);
  }

  // ---- Report ------------------------------------------------------------
  console.log(`${roleFolder}: ${plans.length} person folder(s), department ${department.name}${apply ? "" : " (dry run)"}\n`);
  for (const p of plans) {
    const verdict = p.known
      ? `ALREADY ON FILE as ${p.known.person.full_name} (matched by ${p.known.by}); record untouched`
      : p.twinOf
        ? `SAME PERSON as the folder "${p.twinOf}" in this run; documents go on that record`
        : p.fields
        ? "CREATE"
        : `HELD: ${p.hold}`;
    console.log(`${p.folder}\n  ${verdict}`);
    if (p.cv) console.log(`  cv: ${p.cv.rel}${p.engine ? ` [${p.engine}]` : ""}`);
    if (p.fields && !p.known) {
      const f = p.fields;
      console.log(
        `  ${f.full_name} | ${f.current_role ?? "no role"} | ${f.years_experience ?? "?"} yrs | ${f.work_experience?.length ?? 0} jobs | ` +
          `${f.skills.length}+${f.technical_skills.length} skills | ${f.certifications.length} certs | ${f.education?.length ?? 0} education | ` +
          `email ${f.email ? "yes" : "NO"} | phone ${f.phone ? "yes" : "NO"}`,
      );
      for (const c of recordChecks(f, p.rawText ?? "")) console.log(`  check: ${c}`);
    }
    for (const a of p.attach) console.log(`  attach ${a.kind}: ${a.title}  (${a.file.rel})`);
    for (const l of p.left) console.log(`  leave: ${l.file.rel}  (${l.reason})`);
    console.log("");
  }
  for (const h of heldFolders) console.log(`Folder held back, not a person: ${h.folder} (${h.files} files)`);
  if (loose.length) console.log(`Loose files in the role folder, not loaded: ${loose.length}`);

  const toCreate = plans.filter((p) => p.fields && !p.known);
  const toExtend = plans.filter((p) => p.known || p.twinOf);
  const held = plans.filter((p) => !p.known && !p.fields && !p.twinOf);
  console.log(
    `\nWould create ${toCreate.length}, add documents to ${toExtend.length} already on file, hold ${held.length}. ` +
      `${plans.reduce((n, p) => n + p.attach.length, 0)} attachment(s), ${plans.reduce((n, p) => n + p.left.length, 0)} file(s) left behind.`,
  );
  if (!apply || !operator) {
    console.log("Dry run. Nothing was written. Re-run with --as <email> --apply to load.");
    return;
  }

  // ---- Write -------------------------------------------------------------
  const departmentOptions = (departments ?? []).map((d) => ({ id: d.id, name: d.name, slug: d.slug }));
  let created = 0;
  let attached = 0;
  const createdIn = new Map<string, string>();
  for (const p of plans) {
    if (!p.known && !p.fields && !p.twinOf) continue;
    const dir = path.join(root, p.folder);
    let candidateId = p.known?.person.id ?? (p.twinOf ? (createdIn.get(p.twinOf) ?? null) : null);
    if (p.twinOf && !candidateId) {
      console.error(`${p.folder}: "${p.twinOf}" was not created, so its documents have nowhere to go`);
      continue;
    }
    let label = p.known?.person.full_name ?? "";

    if (!candidateId && p.fields && p.cv) {
      let placed: Placed;
      try {
        placed = await place(path.join(dir, p.cv.rel), p.cv.name, p.folder, "candidates", p.cv.ext);
      } catch (e) {
        console.error(`${p.folder}: CV not placed, person not created: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      const { data: row, error } = await db
        .from("candidates")
        .insert({
          ...withoutNul(toCandidateColumns(p.fields, departmentOptions)),
          ...(placed.kind === "drive"
            ? { cv_drive_id: placed.driveId, cv_drive_item_id: placed.itemId }
            : { cv_file_path: placed.path }),
          cv_original_filename: sanitizeFilename(p.cv.name),
          created_by: operator.id,
        })
        .select("id")
        .single();
      if (error || !row) {
        if (placed.kind === "storage") await db.storage.from(BUCKET).remove([placed.path]);
        console.error(`${p.folder}: not created: ${error?.message ?? "no row returned"}`);
        continue;
      }
      candidateId = row.id;
      createdIn.set(p.folder, row.id);
      label = p.fields.full_name;
      created += 1;
      await db.from("audit_log").insert({
        actor_id: operator.id,
        actor_email: operator.email,
        actor_name: operator.full_name,
        action: "imported",
        entity_type: "candidate",
        entity_id: row.id,
        entity_label: label,
        detail: { source: `${roleFolder}/${p.folder}/${p.cv.rel}`, batch: roleFolder },
      });
      console.log(`created ${label}`);
    }
    if (!candidateId) continue;

    // What this person already has, so a second run adds nothing.
    const { data: existing } = await db
      .from("candidate_attachments")
      .select("original_filename")
      .eq("candidate_id", candidateId);
    const have = new Set((existing ?? []).map((e) => e.original_filename));
    for (const a of p.attach) {
      const original = sanitizeFilename(a.file.name) || "document";
      if (have.has(original)) continue;
      let placed: Placed;
      try {
        placed = await place(path.join(dir, a.file.rel), a.file.name, p.folder, "attachments", a.file.ext);
      } catch (e) {
        console.error(`${p.folder}: ${a.file.rel} not attached: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      const { data: row, error } = await db
        .from("candidate_attachments")
        .insert({
          candidate_id: candidateId,
          kind: a.kind,
          title: a.title,
          ...(placed.kind === "drive"
            ? { drive_id: placed.driveId, drive_item_id: placed.itemId, file_path: null }
            : { file_path: placed.path }),
          original_filename: original,
          created_by: operator.id,
        })
        .select("id")
        .single();
      if (error || !row) {
        if (placed.kind === "storage") await db.storage.from(BUCKET).remove([placed.path]);
        console.error(`${p.folder}: ${a.file.rel} not attached: ${error?.message ?? "no row returned"}`);
        continue;
      }
      have.add(original);
      attached += 1;
      await db.from("audit_log").insert({
        actor_id: operator.id,
        actor_email: operator.email,
        actor_name: operator.full_name,
        action: "imported",
        entity_type: "candidate_attachment",
        entity_id: row.id,
        entity_label: a.title,
        detail: { kind: a.kind, candidate_id: candidateId, source: `${roleFolder}/${p.folder}/${a.file.rel}` },
      });
    }
  }
  console.log(`\nCreated ${created} candidate(s) and attached ${attached} document(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
