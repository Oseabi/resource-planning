/**
 * Link existing candidate files to SharePoint instead of the cvs bucket.
 *
 *   npx tsx --conditions=react-server scripts/repoint-to-sharepoint.ts            (dry run: what would happen)
 *   npx tsx --conditions=react-server scripts/repoint-to-sharepoint.ts --apply    (write the links)
 *
 * For every CV and attachment that still points only at the bucket:
 * - archive imports carry their source ("Role/Person/file") on the "imported"
 *   audit entry; that path is looked up in the library and linked. A .doc CV
 *   that the bucket holds as a converted .docx links to the original .doc.
 * - anything without a source in the library (app uploads, staged zip
 *   contents, converted scans) is uploaded from the bucket into the library,
 *   to "App uploads/<candidate id>/" or "Imported (system)/<role>/<person>/".
 *
 * The bucket copy is kept: the row gets the SharePoint link (which wins when
 * the file is opened) and keeps its object path until
 * scripts/delete-moved-copies.ts has checked the link and removed the copy.
 * Re-running links only what is still unlinked.
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

type Job = { table: "candidates" | "candidate_attachments"; id: string; label: string; path: string; name: string; candidateId: string; source: string | null };

async function main() {
  const apply = process.argv.includes("--apply");
  const env = loadEnv();
  const { candidateDriveId, getItemByPath, uploadFile, isSharePointConfigured } = await import("@/lib/sharepoint/graph");
  const { fetchAll } = await import("@/lib/supabase/fetch-all");
  if (!isSharePointConfigured()) {
    console.error("SharePoint is not configured: set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and SHAREPOINT_DRIVE_ID in .env.local.");
    process.exit(1);
  }
  const driveId = candidateDriveId();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: audit } = await fetchAll<{ entity_id: string; detail: { source?: string } | null }>((from, to) =>
    db.from("audit_log").select("entity_id, detail").eq("action", "imported").order("id").range(from, to),
  );
  const sourceOf = new Map<string, string>();
  for (const a of audit ?? []) if (a.detail?.source) sourceOf.set(a.entity_id, a.detail.source);

  const { data: cands } = await fetchAll<{ id: string; full_name: string; cv_file_path: string | null; cv_original_filename: string | null; cv_drive_item_id: string | null }>(
    (from, to) => db.from("candidates").select("id, full_name, cv_file_path, cv_original_filename, cv_drive_item_id").not("cv_file_path", "is", null).is("cv_drive_item_id", null).order("id").range(from, to),
  );
  const { data: atts } = await fetchAll<{ id: string; candidate_id: string; title: string; file_path: string | null; original_filename: string; drive_item_id: string | null }>(
    (from, to) => db.from("candidate_attachments").select("id, candidate_id, title, file_path, original_filename, drive_item_id").not("file_path", "is", null).is("drive_item_id", null).order("id").range(from, to),
  );
  const jobs: Job[] = [
    ...(cands ?? []).map((c) => ({ table: "candidates" as const, id: c.id, label: c.full_name, path: c.cv_file_path!, name: c.cv_original_filename ?? path.basename(c.cv_file_path!), candidateId: c.id, source: sourceOf.get(c.id) ?? null })),
    ...(atts ?? []).map((a) => ({ table: "candidate_attachments" as const, id: a.id, label: a.title, path: a.file_path!, name: a.original_filename, candidateId: a.candidate_id, source: sourceOf.get(a.id) ?? null })),
  ];
  console.log(`${jobs.length} file(s) still only in the bucket (${cands?.length ?? 0} CVs, ${atts?.length ?? 0} documents). ${apply ? "Linking." : "Dry run."}`);

  let linked = 0, uploaded = 0, failed = 0;
  const unresolved: string[] = [];
  for (const j of jobs) {
    try {
      let itemId: string | null = null;
      let how = "";
      if (j.source) {
        const item = await getItemByPath(driveId, j.source);
        if (item) { itemId = item.id; how = `linked ${j.source}`; }
      }
      if (!itemId) {
        const folder = j.source
          ? `Imported (system)/${path.posix.dirname(j.source)}`
          : `App uploads/${j.candidateId}`;
        how = `upload to ${folder}/ (${j.source ? "source not in the library" : "no archive source"})`;
        if (apply) {
          const { data: blob, error } = await db.storage.from("cvs").download(j.path);
          if (error || !blob) throw new Error(`bucket copy missing: ${error?.message ?? "no data"}`);
          const item = await uploadFile(driveId, folder, j.name, new Uint8Array(await blob.arrayBuffer()), blob.type || undefined);
          itemId = item.id;
        }
        unresolved.push(`${j.table === "candidates" ? "CV" : "doc"} | ${j.label} | ${how}`);
      }
      if (apply && itemId) {
        const update = j.table === "candidates" ? { cv_drive_id: driveId, cv_drive_item_id: itemId } : { drive_id: driveId, drive_item_id: itemId };
        const { error } = await db.from(j.table).update(update).eq("id", j.id);
        if (error) throw new Error(error.message);
      }
      if (how.startsWith("linked")) linked++; else uploaded++;
    } catch (e) {
      failed++;
      console.error(`FAILED ${j.table} ${j.label}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (unresolved.length) {
    console.log(`\nNot found in the library by path (${unresolved.length}), ${apply ? "uploaded" : "would be uploaded"}:`);
    for (const u of unresolved) console.log("  " + u);
  }
  console.log(`\n${apply ? "Done" : "Would do"}: ${linked} linked to existing library files, ${uploaded} uploaded to the library, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
