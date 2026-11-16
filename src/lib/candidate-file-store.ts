import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { candidateDriveId, isSharePointConfigured, uploadFile } from "@/lib/sharepoint/graph";
import { contentTypeFor } from "@/lib/candidate-files";

/**
 * Where a file uploaded through the app is kept.
 *
 * With SharePoint configured, uploads go into the candidate archive library
 * under "App uploads/<candidate id>/", next to the files the archive import
 * links to, so the library holds every candidate document. Without it (local
 * development, or before the Microsoft app is set up) they go to the private
 * cvs bucket as before.
 */

export const APP_UPLOADS_FOLDER = "App uploads";
const BUCKET = "cvs";

export type StoredFile =
  | { kind: "drive"; driveId: string; itemId: string }
  | { kind: "storage"; path: string };

export async function storeCandidateFile(
  file: File,
  candidateId: string,
  storagePath: string,
  contentType?: string,
): Promise<StoredFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = contentType || file.type || contentTypeFor(file.name);
  if (isSharePointConfigured()) {
    const driveId = candidateDriveId();
    const item = await uploadFile(driveId, `${APP_UPLOADS_FOLDER}/${candidateId}`, file.name, bytes, type);
    return { kind: "drive", driveId, itemId: item.id };
  }
  const { error } = await createAdminClient().storage.from(BUCKET).upload(storagePath, Buffer.from(bytes), {
    contentType: type,
    upsert: false,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { kind: "storage", path: storagePath };
}

/** Undo a store whose database row then failed. SharePoint files are left: the app never deletes from the library. */
export async function discardStoredFile(stored: StoredFile): Promise<void> {
  if (stored.kind === "storage") await createAdminClient().storage.from(BUCKET).remove([stored.path]);
}
