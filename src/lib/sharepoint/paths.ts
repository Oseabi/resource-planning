/**
 * Paths inside the SharePoint document library, as Graph wants them.
 *
 * No I/O here, so scripts and tests can use it without credentials.
 */

/** One path segment encoded for a Graph "root:/a/b:" address. */
function encodeSegment(segment: string): string {
  // encodeURIComponent leaves ' ( ) ! * alone; Graph accepts them, but a ' in a
  // path segment breaks OData parsing, so double it as OData expects.
  return encodeURIComponent(segment.replace(/'/g, "''"));
}

/** "Role/Person/CV.pdf" -> "Role/Person/CV.pdf" encoded per segment, no leading slash. */
export function encodeDrivePath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/)
    .filter((s) => s.length > 0)
    .map(encodeSegment)
    .join("/");
}

/**
 * The path of a synced file relative to the library root, with forward slashes.
 * Returns null when the file is not inside the synced library.
 */
export function libraryRelativePath(libraryRoot: string, absolutePath: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const root = norm(libraryRoot);
  const file = norm(absolutePath);
  if (file.toLowerCase() === root.toLowerCase()) return null;
  if (!file.toLowerCase().startsWith(root.toLowerCase() + "/")) return null;
  return file.slice(root.length + 1);
}

/** A folder and file name joined for upload, with characters SharePoint refuses replaced. */
export function safeDriveName(name: string): string {
  // SharePoint rejects " * : < > ? / \ | and names ending in a dot or space.
  return name.replace(/["*:<>?/\\|]/g, "_").replace(/[. ]+$/, "") || "file";
}

/** Graph's simple upload takes up to 4 MB; larger files need an upload session. */
export const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

/** Upload-session chunks must be multiples of 320 KiB. */
export const UPLOAD_CHUNK = 320 * 1024 * 10; // 3.125 MiB
