/**
 * Load a batch of OEM authorisation letters, each with its PDF.
 *
 *   npx tsx scripts/import-oem-letters.ts <manifest.json> [--as <email>] [--apply]
 *
 * Dry run is the default and prints exactly what it would write. Nothing is
 * uploaded or inserted without --apply, and --apply needs --as so created_by
 * names a real person.
 *
 * The manifest is a JSON array, one entry per letter, in the shape of the
 * OEM letter form (title, oem_vendor, categories, reference_number,
 * issued_to, issue_date, expiry_date, notes) plus "file", the PDF on disk,
 * and "original_filename", the name to show for it. Dates are ISO
 * (YYYY-MM-DD). The manifest stays out of the repo; a letter is loaded once.
 *
 * Per letter it uploads the PDF to the letters bucket under letters/, the
 * same place the form puts one, inserts the row, writes an "imported" event
 * on the letter's timeline and an "imported" line in the audit log naming the
 * source file. A letter whose vendor and title are already on file is skipped
 * rather than duplicated. It never updates or deletes a letter.
 *
 * Builds its own Supabase client because modules marked "server-only" cannot
 * load outside Next.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CATEGORY_NAMES } from "@/lib/resource-categories";
import { expiryStatus } from "@/lib/oem-letters";

interface LetterEntry {
  file: string;
  original_filename: string;
  title: string;
  oem_vendor: string;
  categories: string[];
  reference_number: string | null;
  issued_to: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
}

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
  if (!trimmed(entry.title)) out.push("title is required");
  if (!trimmed(entry.oem_vendor)) out.push("oem_vendor is required");
  if (!entry.file || !fs.existsSync(entry.file)) out.push(`file not found: ${entry.file}`);
  else if (path.extname(entry.file).toLowerCase() !== ".pdf") out.push("file is not a PDF");
  if (!trimmed(entry.original_filename)) out.push("original_filename is required");
  for (const key of ["issue_date", "expiry_date"] as const) {
    const v = entry[key];
    if (v != null && !ISO_DATE.test(v)) out.push(`${key} is not YYYY-MM-DD: ${v}`);
  }
  if (entry.issue_date && entry.expiry_date && entry.expiry_date < entry.issue_date) {
    out.push("the letter cannot expire before it was issued");
  }
  if (!Array.isArray(entry.categories)) out.push("categories must be an array");
  return out;
}

const key = (vendor: string, title: string) => `${vendor.trim().toLowerCase()}|${title.trim().toLowerCase()}`;

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("usage: npx tsx scripts/import-oem-letters.ts <manifest.json> [--as <email>] [--apply]");
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

  const { data: existing, error: existingError } = await db.from("oem_letters").select("oem_vendor, title");
  if (existingError) {
    console.error(`Could not read oem_letters: ${existingError.message}`);
    process.exit(1);
  }
  const onFile = new Set((existing ?? []).map((l) => key(l.oem_vendor, l.title)));

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
    const k = key(entry.oem_vendor, entry.title);
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

  const today = new Date();
  console.log(`${plan.length} letters in ${path.basename(file)}, ${onFile.size} already on file.\n`);
  plan.forEach(({ entry, skip }, i) => {
    const bits = [
      entry.issue_date ? `issued ${entry.issue_date}` : "undated",
      entry.expiry_date ? `expires ${entry.expiry_date} (${expiryStatus(entry.expiry_date, today)})` : "no expiry",
      entry.categories.join(", ") || "no practice area",
    ];
    console.log(`${String(i + 1).padStart(2)}. ${skip ? `SKIP (${skip}) ` : ""}${entry.oem_vendor}: ${entry.title}`);
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
    const storagePath = `letters/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await db.storage
      .from(LETTER_BUCKET)
      .upload(storagePath, fs.readFileSync(entry.file), { contentType: "application/pdf", upsert: false });
    if (uploadError) {
      console.error(`\n${entry.original_filename}: upload failed: ${uploadError.message}`);
      console.error(`${loaded} loaded before the failure; the rest were not written.`);
      process.exit(1);
    }

    const { data: row, error: insertError } = await db
      .from("oem_letters")
      .insert({
        title: entry.title.trim(),
        oem_vendor: entry.oem_vendor.trim(),
        categories: entry.categories,
        reference_number: trimmed(entry.reference_number),
        issued_to: trimmed(entry.issued_to),
        issue_date: entry.issue_date,
        expiry_date: entry.expiry_date,
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

    // On the letter's own timeline, the way an imported tender is, and in the
    // audit log, so the trail can account for every letter.
    await db.from("activity").insert({
      entity_type: "oem_letter",
      entity_id: row.id,
      kind: "event",
      action: "imported",
      detail: { source: entry.original_filename },
      actor_id: operator.id,
    });
    await db.from("audit_log").insert({
      actor_id: operator.id,
      actor_email: operator.email,
      actor_name: operator.full_name,
      action: "imported",
      entity_type: "oem_letter",
      entity_id: row.id,
      entity_label: `${entry.oem_vendor.trim()}: ${entry.title.trim()}`,
      detail: { source: entry.original_filename, batch: path.basename(file) },
    });
    loaded += 1;
  }

  console.log(`\nLoaded ${loaded} OEM letter(s) with their PDFs.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
