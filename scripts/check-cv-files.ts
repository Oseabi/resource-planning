/**
 * Lists candidates whose stored CV file is missing from storage.
 *
 *   npx tsx scripts/check-cv-files.ts
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
