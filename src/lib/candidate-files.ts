/**
 * Where a candidate's file lives and how it is served.
 *
 * No I/O, so the route, scripts and tests share one rule: a SharePoint item
 * wins over an object path in the cvs bucket, and a row with neither has no
 * file. Old rows keep working until they are moved to SharePoint.
 */

export type FileSource =
  | { type: "drive"; driveId: string; itemId: string }
  | { type: "storage"; path: string };

export function cvSource(row: {
  cv_drive_id?: string | null;
  cv_drive_item_id?: string | null;
  cv_file_path?: string | null;
}): FileSource | null {
  if (row.cv_drive_id && row.cv_drive_item_id) return { type: "drive", driveId: row.cv_drive_id, itemId: row.cv_drive_item_id };
  if (row.cv_file_path) return { type: "storage", path: row.cv_file_path };
  return null;
}

export function attachmentSource(row: {
  drive_id?: string | null;
  drive_item_id?: string | null;
  file_path?: string | null;
}): FileSource | null {
  if (row.drive_id && row.drive_item_id) return { type: "drive", driveId: row.drive_id, itemId: row.drive_item_id };
  if (row.file_path) return { type: "storage", path: row.file_path };
  return null;
}

/** The app's own address for a file; the browser never sees a storage or SharePoint link. */
export type FileKind = "cv" | "attachment" | "tender" | "oem-letter" | "reference-letter";

export function fileRoute(kind: FileKind, id: string): string {
  return `/api/files/${kind}/${encodeURIComponent(id)}`;
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export function contentTypeFor(filename: string | null | undefined): string {
  const ext = (filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Inline so PDFs and images open in the tab; RFC 5987 so non-ASCII names survive. */
export function contentDisposition(filename: string | null | undefined): string {
  const name = (filename ?? "file").replace(/[\r\n"]/g, "");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
