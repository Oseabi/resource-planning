import "server-only";
import { encodeDrivePath, safeDriveName, SIMPLE_UPLOAD_LIMIT, UPLOAD_CHUNK } from "@/lib/sharepoint/paths";

/**
 * Microsoft Graph access to the SharePoint library that holds candidate files.
 *
 * App-only (client credentials) with the Sites.Selected permission, granted to
 * the Resourcing site alone, so the app can reach nothing else in the tenant.
 * The secret lives in the server environment only; nothing here runs in the
 * browser, and the browser never receives a SharePoint link: files are
 * streamed through the app's own authenticated route.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

type Fetch = typeof fetch;

export interface DriveItem {
  id: string;
  name: string;
  size: number;
  webUrl?: string;
  file?: { mimeType?: string };
  folder?: unknown;
}

export function isSharePointConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.SHAREPOINT_DRIVE_ID);
}

/** The library that holds candidate files. */
export function candidateDriveId(env: NodeJS.ProcessEnv = process.env): string {
  const id = env.SHAREPOINT_DRIVE_ID;
  if (!id) throw new Error("SHAREPOINT_DRIVE_ID is not set.");
  return id;
}

let cached: { token: string; expires: number } | null = null;

/** For tests. */
export function resetTokenCache() {
  cached = null;
}

/** A client-credentials token, reused until five minutes before it expires. */
export async function getGraphToken(env: NodeJS.ProcessEnv = process.env, fetchImpl: Fetch = fetch, now = Date.now()): Promise<string> {
  if (cached && cached.expires - 5 * 60_000 > now) return cached.token;
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    throw new Error("Microsoft Graph is not configured (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET).");
  }
  const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(MS_TENANT_ID)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    // The body names the failure (bad secret, no consent) without echoing the secret.
    const text = await res.text().catch(() => "");
    throw new Error(`Graph sign-in failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expires: now + json.expires_in * 1000 };
  return json.access_token;
}

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A Graph call with the app token. Throws GraphError on anything but 2xx (404 included). */
export async function graphFetch(path: string, init: RequestInit = {}, fetchImpl: Fetch = fetch): Promise<Response> {
  const token = await getGraphToken(process.env, fetchImpl);
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { ...init, headers });
    // Graph throttles with 429/503 and says how long to wait.
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      const wait = Number(res.headers.get("Retry-After") ?? "2");
      await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 1), 30) * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GraphError(res.status, `Graph ${init.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return res;
  }
}

const ITEM_FIELDS = "$select=id,name,size,webUrl,file,folder";

/** The item at a library-relative path, or null when nothing is there. */
export async function getItemByPath(driveId: string, relativePath: string, fetchImpl: Fetch = fetch): Promise<DriveItem | null> {
  try {
    const res = await graphFetch(`/drives/${driveId}/root:/${encodeDrivePath(relativePath)}?${ITEM_FIELDS}`, {}, fetchImpl);
    return (await res.json()) as DriveItem;
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null;
    throw e;
  }
}

/** The item with this id, or null when it has gone. */
export async function getItem(driveId: string, itemId: string, fetchImpl: Fetch = fetch): Promise<DriveItem | null> {
  try {
    const res = await graphFetch(`/drives/${driveId}/items/${encodeURIComponent(itemId)}?${ITEM_FIELDS}`, {}, fetchImpl);
    return (await res.json()) as DriveItem;
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null;
    throw e;
  }
}

/** The file's bytes as a stream; Graph redirects to a short-lived download URL that fetch follows. */
export async function downloadItem(driveId: string, itemId: string, fetchImpl: Fetch = fetch): Promise<Response> {
  return graphFetch(`/drives/${driveId}/items/${encodeURIComponent(itemId)}/content`, {}, fetchImpl);
}

/**
 * Upload a file into a library folder (created as needed). A name that is
 * already taken gets a number added rather than replacing the existing file.
 */
export async function uploadFile(
  driveId: string,
  folderPath: string,
  name: string,
  bytes: Uint8Array,
  contentType = "application/octet-stream",
  fetchImpl: Fetch = fetch,
): Promise<DriveItem> {
  const target = encodeDrivePath(`${folderPath}/${safeDriveName(name)}`);
  if (bytes.byteLength <= SIMPLE_UPLOAD_LIMIT) {
    const res = await graphFetch(
      `/drives/${driveId}/root:/${target}:/content?@microsoft.graph.conflictBehavior=rename`,
      { method: "PUT", headers: { "Content-Type": contentType }, body: bytes as BodyInit },
      fetchImpl,
    );
    return (await res.json()) as DriveItem;
  }
  const session = await graphFetch(
    `/drives/${driveId}/root:/${target}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
    },
    fetchImpl,
  );
  const { uploadUrl } = (await session.json()) as { uploadUrl: string };
  let last: Response | null = null;
  for (let start = 0; start < bytes.byteLength; start += UPLOAD_CHUNK) {
    const end = Math.min(start + UPLOAD_CHUNK, bytes.byteLength);
    // The upload URL is pre-authorised: it must not carry the bearer token.
    last = await fetchImpl(uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${bytes.byteLength}` },
      body: bytes.slice(start, end) as BodyInit,
    });
    if (!last.ok && last.status !== 202) {
      throw new GraphError(last.status, `Upload of ${name} failed at byte ${start} (${last.status}).`);
    }
  }
  return (await last!.json()) as DriveItem;
}
