/**
 * Find the SharePoint document library that holds the candidate archive.
 *
 *   npx tsx --conditions=react-server scripts/sharepoint-info.ts "https://<tenant>.sharepoint.com/sites/<site>"
 *
 * Signs in to Microsoft Graph with MS_TENANT_ID, MS_CLIENT_ID and
 * MS_CLIENT_SECRET from .env.local (never printed), looks the site up from
 * its address and lists its document libraries with their drive ids. Put the
 * candidate library's id in .env.local as SHAREPOINT_DRIVE_ID. Read-only.
 *
 * With the Sites.Selected permission the app can only see sites it has been
 * granted, so a 403 here means the site grant is missing.
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const file = path.resolve(".env.local");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv();
  const siteUrl = process.argv[2];
  if (!siteUrl) {
    console.error('Usage: scripts/sharepoint-info.ts "https://<tenant>.sharepoint.com/sites/<site>"');
    process.exit(1);
  }
  const { graphFetch } = await import("@/lib/sharepoint/graph");
  const u = new URL(siteUrl);
  const sitePath = u.pathname.replace(/\/+$/, "");
  const site = (await (await graphFetch(`/sites/${u.hostname}:${sitePath}`)).json()) as { id: string; displayName: string; webUrl: string };
  console.log(`Site: ${site.displayName}  (${site.webUrl})`);
  console.log(`  site id: ${site.id}`);
  const drives = (await (await graphFetch(`/sites/${site.id}/drives?$select=id,name,webUrl`)).json()) as {
    value: { id: string; name: string; webUrl: string }[];
  };
  console.log("Document libraries:");
  for (const d of drives.value) {
    const mark = /candidate/i.test(d.name) ? "   <- candidate archive?" : "";
    console.log(`  ${d.name}\n    drive id: ${d.id}${mark}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
