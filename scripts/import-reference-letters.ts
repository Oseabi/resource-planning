/**
 * Load a batch of client reference letters, each with its PDF.
 *
 *   npx tsx scripts/import-reference-letters.ts <manifest.json> [--as <email>] [--apply]
 *
 * Dry run is the default and prints exactly what it would write. Nothing is
 * uploaded or inserted without --apply, and --apply needs --as so created_by
 * names a real person.
 *
 * The manifest is a JSON array, one entry per letter, in the shape of the
 * reference letter form (client, project_title, categories, sectors,
 * contract_value, work_started_on, work_completed_on, issue_date, contact_*,
 * reference_number, notes) plus "file", the PDF on disk, and
 * "original_filename", the name to show for it. Dates are ISO (YYYY-MM-DD).
 * The manifest itself stays out of the repo: it carries client contact
 * details, and a letter is loaded once.
 *
 * Per letter it uploads the PDF to the letters bucket under references/, the
 * same place the form puts one, inserts the row, and writes an "imported"
 * line to the audit log naming the source file, so the trail says where each
 * letter came from. A letter whose client and project title are already on
 * file is skipped rather than duplicated. It never updates or deletes a
 * letter, and never touches tenders.
 *
 * Builds its own Supabase client because modules marked "server-only" cannot
 * load outside Next.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CATEGORY_NAMES } from "@/lib/resource-categories";

interface LetterEntry {
  file: string;
  original_filename: string;
  client: string;
  project_title: string;
  categories: string[];
  sectors: string[];
  contract_value: number | null;
  work_started_on: string | null;
  work_completed_on: string | null;
  issue_date: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  reference_number: string | null;
  notes: string | null;
}

// Shares the OEM letters bucket, as the form does; see reference-letters/actions.ts.
const LETTER_BUCKET = "oem-letters";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

/** The problems with one entry, empty when it is fit to load. */
function problems(entry: LetterEntry): string[] {
  const out: string[] = [];
  if (!trimmed(entry.client)) out.push("client is required");
  if (!trimmed(entry.project_title)) out.push("project_title is required");
  if (!entry.file || !fs.existsSync(entry.file)) out.push(`file not found: ${entry.file}`);
  else if (path.extname(entry.file).toLowerCase() !== ".pdf") out.push("file is not a PDF");
  if (!trimmed(entry.original_filename)) out.push("original_filename is required");
  for (const key of ["work_started_on", "work_completed_on", "issue_date"] as const) {
    const v = entry[key];
    if (v != null && !ISO_DATE.test(v)) out.push(`${key} is not YYYY-MM-DD: ${v}`);
  }
  if (entry.work_started_on && entry.work_completed_on && entry.work_completed_on < entry.work_started_on) {
    out.push("the work cannot finish before it starts");
  }
  if (entry.contract_value != null && !(typeof entry.contract_value === "number" && entry.contract_value >= 0)) {
    out.push(`contract_value is not a non-negative number: ${String(entry.contract_value)}`);
  }
  if (!Array.isArray(entry.categories) || !Array.isArray(entry.sectors)) out.push("categories and sectors must be arrays");
  return out;
}

const key = (client: string, title: string) => `${client.trim().toLowerCase()}|${title.trim().toLowerCase()}`;

function money(value: number | null): string {
  return value == null ? "" : `R${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("usage: npx tsx scripts/import-reference-letters.ts <manifest.json> [--as <email>] [--apply]");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }

  const apply = has("apply");
  const operatorEmail = flag("as");
  if (apply && !operatorEmail) {
    console.error("--apply needs --as <email>, so created_by names a real person.");
    process.exit(1);
  }

  const entries = JSON.parse(fs.readFileSync(file, "utf8")) as LetterEntry[];
  if (!Array.isArray(entries) || entries.length === 0) {
    console.error("The manifest must be a non-empty JSON array.");
    process.exit(1);
  }

  const env = readEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let operator: { id: string; email: string; full_name: string } | null = null;
  if (operatorEmail) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, email, full_name")
      .eq("email", operatorEmail);
    if (!profiles || profiles.length !== 1) {
      console.error(`--as ${operatorEmail} matched ${profiles?.length ?? 0} profiles. It has to match exactly one.`);
      process.exit(1);
    }
    operator = profiles[0];
  }

  const { data: existing, error: existingError } = await db
    .from("reference_letters")
    .select("client, project_title");
  if (existingError) {
    console.error(`Could not read reference_letters: ${existingError.message}`);
    process.exit(1);
  }
  const onFile = new Set((existing ?? []).map((l) => key(l.client, l.project_title)));

  // Validate everything before writing anything, so a bad entry near the end
  // does not leave half a batch loaded.
  let invalid = 0;
  const seen = new Set<string>();
  const plan: { entry: LetterEntry; skip: string | null }[] = [];
  const customCategories = new Set<string>();
  entries.forEach((entry, i) => {
    const issues = problems(entry);
    if (issues.length > 0) {
      invalid += 1;
      console.error(`entry ${i + 1} (${entry.original_filename ?? "?"}): ${issues.join("; ")}`);
      return;
    }
    const k = key(entry.client, entry.project_title);
    let skip: string | null = null;
    if (onFile.has(k)) skip = "already on file";
    else if (seen.has(k)) skip = "repeated in the manifest";
    seen.add(k);
    for (const c of entry.categories) if (!CATEGORY_NAMES.includes(c)) customCategories.add(c);
    plan.push({ entry, skip });
  });
  if (invalid > 0) {
    console.error(`\n${invalid} entr${invalid === 1 ? "y" : "ies"} invalid. Nothing written.`);
    process.exit(1);
  }

  console.log(`${plan.length} letters in ${path.basename(file)}, ${onFile.size} already on file.\n`);
  plan.forEach(({ entry, skip }, i) => {
    const contactable = Boolean(trimmed(entry.contact_email) || trimmed(entry.contact_phone));
    const bits = [
      entry.issue_date ?? "undated",
      money(entry.contract_value),
      contactable ? "contactable" : "NO CONTACT",
      entry.categories.join(", ") || "no practice area",
    ].filter(Boolean);
    console.log(`${String(i + 1).padStart(2)}. ${skip ? `SKIP (${skip}) ` : ""}${entry.client}`);
    console.log(`    ${entry.project_title}`);
    console.log(`    ${bits.join(" | ")}`);
    console.log(`    ${entry.original_filename}`);
  });
  if (customCategories.size > 0) {
    console.log(
      `\nPractice areas outside the app's vocabulary (kept as typed): ${[...customCategories].sort().join(", ")}`,
    );
  }

  const toLoad = plan.filter((p) => !p.skip);
  if (!apply) {
    console.log(`\nDry run. ${toLoad.length} would be loaded. Re-run with --as <email> --apply to write them.`);
    return;
  }
  if (!operator) return;

  let loaded = 0;
  for (const { entry } of toLoad) {
    const storagePath = `references/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await db.storage
      .from(LETTER_BUCKET)
      .upload(storagePath, fs.readFileSync(entry.file), { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      console.error(`\n${entry.original_filename}: upload failed: ${uploadError.message}`);
      console.error(`${loaded} loaded before the failure; the rest were not written.`);
      process.exit(1);
    }

    const { data: row, error: insertError } = await db
      .from("reference_letters")
      .insert({
        client: entry.client.trim(),
        project_title: entry.project_title.trim(),
        categories: entry.categories,
        sectors: entry.sectors,
        contract_value: entry.contract_value,
        work_started_on: entry.work_started_on,
        work_completed_on: entry.work_completed_on,
        issue_date: entry.issue_date,
        contact_name: trimmed(entry.contact_name),
        contact_email: trimmed(entry.contact_email),
        contact_phone: trimmed(entry.contact_phone),
        reference_number: trimmed(entry.reference_number),
        notes: trimmed(entry.notes),
        file_path: storagePath,
        original_filename: sanitizeFilename(entry.original_filename),
        created_by: operator.id,
      })
      .select("id")
      .single();
    if (insertError || !row) {
      // The file must not outlive the row it was uploaded for.
      await db.storage.from(LETTER_BUCKET).remove([storagePath]);
      console.error(`\n${entry.original_filename}: insert failed: ${insertError?.message ?? "no row returned"}`);
      console.error(`${loaded} loaded before the failure; the rest were not written.`);
      process.exit(1);
    }

    // Says the record arrived by import and from which file, the way the
    // tender importer does, so the trail can account for every letter.
    await db.from("audit_log").insert({
      actor_id: operator.id,
      actor_email: operator.email,
      actor_name: operator.full_name,
      action: "imported",
      entity_type: "reference_letter",
      entity_id: row.id,
      entity_label: `${entry.client.trim()}: ${entry.project_title.trim()}`,
      detail: { source: entry.original_filename, batch: path.basename(file) },
    });
    loaded += 1;
  }

  console.log(`\nLoaded ${loaded} reference letter(s) with their PDFs.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
