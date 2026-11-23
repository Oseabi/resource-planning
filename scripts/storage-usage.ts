/**
 * How much file storage the project uses, per bucket and top-level folder.
 *
 *   npx tsx scripts/storage-usage.ts
 *
 * Reads .env.local for the service-role key and only lists objects; it changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function readEnv(): Record<string, string> {
  const file = path.resolve(".env.local");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const env = readEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: buckets, error } = await db.storage.listBuckets();
  if (error) throw error;
  let total = 0;
  for (const b of buckets ?? []) {
    const byFolder = new Map<string, { bytes: number; files: number }>();
    const walk = async (prefix: string): Promise<void> => {
      for (let offset = 0; ; offset += 1000) {
        const { data, error: e } = await db.storage.from(b.name).list(prefix, { limit: 1000, offset });
        if (e) throw e;
        for (const o of data ?? []) {
          const full = prefix ? `${prefix}/${o.name}` : o.name;
          if (o.id === null) await walk(full);
          else {
            const top = full.includes("/") ? full.split("/")[0] : "(root)";
            const s = byFolder.get(top) ?? { bytes: 0, files: 0 };
            s.bytes += Number((o.metadata as { size?: number } | null)?.size ?? 0);
            s.files += 1;
            byFolder.set(top, s);
          }
        }
        if (!data || data.length < 1000) break;
      }
    };
    await walk("");
    for (const [folder, s] of byFolder) {
      total += s.bytes;
      console.log(`${b.name}/${folder}: ${(s.bytes / 1048576).toFixed(1)} MB in ${s.files} files`);
    }
  }
  console.log(`Total: ${(total / 1048576).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
