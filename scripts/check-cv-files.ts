/**
 * Lists candidates whose stored CV file is missing from storage.
 *
 *   npx tsx scripts/check-cv-files.ts
 *   npx tsx --conditions=react-server scripts/check-cv-files.ts --sharepoint
 *
 * With --sharepoint it also checks that every CV and document linked to
 * SharePoint still resolves there (needs the Graph settings in .env.local).
 *
 * A dropped connection during an import can leave a candidate row whose CV was
 * removed as the failed upload was cleaned up. Reads .env.local for the
 * service-role key and only reads; it changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "cvs";

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const env = readEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const stored = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list("candidates", { limit: 1000, offset });
    if (error) throw error;
    for (const o of data ?? []) stored.add(`candidates/${o.name}`);
    if (!data || data.length < 1000) break;
  }

  const rows: { id: string; full_name: string; cv_file_path: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("candidates").select("id, full_name, cv_file_path").order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const missing = rows.filter((r) => r.cv_file_path && r.cv_file_path.startsWith("candidates/") && !stored.has(r.cv_file_path));
  console.log(`${rows.length} candidates, ${stored.size} CV files in storage, ${missing.length} with a missing CV file`);
  for (const r of missing) console.log(`  ${r.full_name} (${r.id})`);

  if (!process.argv.includes("--sharepoint")) return;
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
  const { getItem } = await import("@/lib/sharepoint/graph");
  const links: { label: string; driveId: string; itemId: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("candidates").select("full_name, cv_drive_id, cv_drive_item_id").not("cv_drive_item_id", "is", null).order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) links.push({ label: `CV of ${r.full_name}`, driveId: r.cv_drive_id!, itemId: r.cv_drive_item_id! });
    if (!data || data.length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("candidate_attachments").select("title, candidate_id, drive_id, drive_item_id").not("drive_item_id", "is", null).order("id").range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) links.push({ label: `${r.title} (candidate ${r.candidate_id})`, driveId: r.drive_id!, itemId: r.drive_item_id! });
    if (!data || data.length < 1000) break;
  }
  const broken: string[] = [];
  for (const l of links) if (!(await getItem(l.driveId, l.itemId))) broken.push(l.label);
  console.log(`${links.length} SharePoint links checked, ${broken.length} broken`);
  for (const b of broken) console.log(`  ${b}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
