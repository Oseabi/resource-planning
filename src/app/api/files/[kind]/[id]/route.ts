import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadItem, GraphError } from "@/lib/sharepoint/graph";
import { attachmentSource, contentDisposition, contentTypeFor, cvSource, type FileSource } from "@/lib/candidate-files";

const CV_BUCKET = "cvs";
/** OEM and reference letters share one private bucket. */
const LETTER_BUCKET = "oem-letters";

/**
 * Stream a candidate's CV, a document on their file, a tender's RFQ document,
 * or an OEM or reference letter.
 *
 * The row is read with the signed-in user's own client, so the database's row
 * rules decide who may see it, exactly as for the profile page. The bytes come
 * from SharePoint (through Graph, with the app's credentials) or, for files
 * not yet moved, from the private cvs bucket. Either way the browser only ever
 * sees this route: no SharePoint or storage link leaves the server.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let source: FileSource | null = null;
  let filename: string | null = null;
  let bucket = CV_BUCKET;
  if (kind === "cv") {
    // "*" rather than naming the SharePoint columns, so the CV still opens on
    // a database where migration 0027 has not run yet.
    const { data } = await supabase
      .from("candidates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      source = cvSource(data);
      filename = data.cv_original_filename;
    }
  } else if (kind === "attachment") {
    const { data } = await supabase
      .from("candidate_attachments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      source = attachmentSource(data);
      filename = data.original_filename;
    }
  } else if (kind === "tender") {
    const { data } = await supabase.from("tenders").select("source_document_path").eq("id", id).maybeSingle();
    if (data?.source_document_path) {
      source = { type: "storage", path: data.source_document_path };
      const ext = data.source_document_path.includes(".") ? data.source_document_path.split(".").pop() : null;
      filename = ext ? `RFQ document.${ext}` : "RFQ document";
    }
  } else if (kind === "oem-letter" || kind === "reference-letter") {
    const table = kind === "oem-letter" ? "oem_letters" : "reference_letters";
    const { data } = await supabase.from(table).select("file_path, original_filename").eq("id", id).maybeSingle();
    if (data?.file_path) {
      source = { type: "storage", path: data.file_path };
      filename = data.original_filename ?? (kind === "oem-letter" ? "OEM letter" : "Reference letter");
      bucket = LETTER_BUCKET;
    }
  } else {
    return NextResponse.json({ error: "Unknown file kind." }, { status: 404 });
  }
  if (!source) return NextResponse.json({ error: "No file on record." }, { status: 404 });

  const headers = new Headers({
    "Content-Type": contentTypeFor(filename),
    "Content-Disposition": contentDisposition(filename),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });

  if (source.type === "drive") {
    try {
      const res = await downloadItem(source.driveId, source.itemId);
      return new Response(res.body, { headers });
    } catch (e) {
      if (e instanceof GraphError && e.status === 404) {
        return NextResponse.json({ error: "The file is no longer in SharePoint." }, { status: 404 });
      }
      console.error("SharePoint download failed", e);
      return NextResponse.json({ error: "Could not fetch the file from SharePoint." }, { status: 502 });
    }
  }

  // The path comes from the row itself; still, the cvs bucket holds CVs,
  // attachments and tender documents side by side, so each kind is only ever
  // served from its own folder. Letters have a bucket of their own.
  const allowed =
    kind === "attachment"
      ? source.path.startsWith("attachments/")
      : kind === "tender"
        ? source.path.startsWith("tenders/")
        : kind === "cv"
          ? !source.path.startsWith("tenders/")
          : true;
  if (!allowed) return NextResponse.json({ error: "No file on record." }, { status: 404 });
  const { data, error } = await createAdminClient().storage.from(bucket).download(source.path);
  if (error || !data) return NextResponse.json({ error: "The file is missing from storage." }, { status: 404 });
  return new Response(data.stream(), { headers });
}
