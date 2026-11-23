/**
 * Remove bucket copies of files that now live in SharePoint.
 *
 *   npx tsx --conditions=react-server scripts/delete-moved-copies.ts            (dry run: count and size)
 *   npx tsx --conditions=react-server scripts/delete-moved-copies.ts --apply    (delete; permanent)
 *
 * A copy is removed only when its row links to a SharePoint item AND Graph
 * confirms that item exists. Then the bucket object is deleted and the row's
 * object path cleared, so the row points at SharePoint alone. Rows whose
 * SharePoint item cannot be found are listed and left untouched.
 *
 * Deleting from the bucket cannot be undone; run the dry run first and only
 * apply once the person responsible has agreed.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
  return env;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadEnv();
  const { getItem, isSharePointConfigured } = await import("@/lib/sharepoint/graph");
  const { fetchAll } = await import("@/lib/supabase/fetch-all");
  if (!isSharePointConfigured()) {
    console.error("SharePoint is not configured.");
    process.exit(1);
  }
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: cands } = await fetchAll<{ id: string; full_name: string; cv_file_path: string; cv_drive_id: string; cv_drive_item_id: string }>((from, to) =>
    db.from("candidates").select("id, full_name, cv_file_path, cv_drive_id, cv_drive_item_id").not("cv_file_path", "is", null).not("cv_drive_item_id", "is", null).order("id").range(from, to),
  );
  const { data: atts } = await fetchAll<{ id: string; title: string; file_path: string; drive_id: string; drive_item_id: string }>((from, to) =>
    db.from("candidate_attachments").select("id, title, file_path, drive_id, drive_item_id").not("file_path", "is", null).not("drive_item_id", "is", null).order("id").range(from, to),
  );
  const rows = [
    ...(cands ?? []).map((c) => ({ table: "candidates" as const, id: c.id, label: c.full_name, objectPath: c.cv_file_path, driveId: c.cv_drive_id, itemId: c.cv_drive_item_id })),
    ...(atts ?? []).map((a) => ({ table: "candidate_attachments" as const, id: a.id, label: a.title, objectPath: a.file_path, driveId: a.drive_id, itemId: a.drive_item_id })),
  ];

  // Object sizes, for the report.
  const sizes = new Map<string, number>();
  for (const prefix of ["candidates", "attachments"]) {
    for (let offset = 0; ; offset += 1000) {
      const { data } = await db.storage.from("cvs").list(prefix, { limit: 1000, offset });
      if (!data || data.length === 0) break;
      for (const o of data) sizes.set(`${prefix}/${o.name}`, (o.metadata as { size?: number } | null)?.size ?? 0);
      if (data.length < 1000) break;
    }
  }

  const ok: typeof rows = [];
  const broken: string[] = [];
  for (const r of rows) {
    const item = await getItem(r.driveId, r.itemId);
    if (item) ok.push(r);
    else broken.push(`${r.table} | ${r.label} | SharePoint item not found; bucket copy kept`);
  }
  const bytes = ok.reduce((n, r) => n + (sizes.get(r.objectPath) ?? 0), 0);
  console.log(`${ok.length} bucket copies have a verified SharePoint file (${(bytes / 1048576).toFixed(1)} MB). ${broken.length} links could not be verified.`);
  for (const b of broken) console.log("  " + b);
  if (!apply) {
    console.log("\nDry run. Nothing deleted. Re-run with --apply to delete these copies (permanent).");
    return;
  }

  let removed = 0;
  for (let i = 0; i < ok.length; i += 100) {
    const batch = ok.slice(i, i + 100);
    const { error } = await db.storage.from("cvs").remove(batch.map((r) => r.objectPath));
    if (error) {
      console.error(`Batch ${i / 100 + 1} not deleted: ${error.message}`);
      continue;
    }
    for (const r of batch) {
      const update = r.table === "candidates" ? { cv_file_path: null } : { file_path: null };
      const { error: e2 } = await db.from(r.table).update(update).eq("id", r.id);
      if (e2) console.error(`${r.label}: copy deleted but path not cleared: ${e2.message}`);
      else removed++;
    }
  }
  console.log(`Deleted ${removed} bucket copies.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
