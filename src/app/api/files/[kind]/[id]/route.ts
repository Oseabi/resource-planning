import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadItem, GraphError } from "@/lib/sharepoint/graph";
import { attachmentSource, contentDisposition, contentTypeFor, cvSource, type FileSource } from "@/lib/candidate-files";

const BUCKET = "cvs";

/**
 * Stream a candidate's CV or a document on their file.
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
  if (kind === "cv") {
    const { data } = await supabase
      .from("candidates")
      .select("cv_file_path, cv_original_filename, cv_drive_id, cv_drive_item_id")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      source = cvSource(data);
      filename = data.cv_original_filename;
    }
  } else if (kind === "attachment") {
    const { data } = await supabase
      .from("candidate_attachments")
      .select("file_path, original_filename, drive_id, drive_item_id")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      source = attachmentSource(data);
      filename = data.original_filename;
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

  // The path comes from the row itself; still, the bucket also holds tender
  // documents, so never serve those from here.
  const allowed = kind === "attachment" ? source.path.startsWith("attachments/") : !source.path.startsWith("tenders/");
  if (!allowed) return NextResponse.json({ error: "No file on record." }, { status: 404 });
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(source.path);
  if (error || !data) return NextResponse.json({ error: "The file is missing from storage." }, { status: 404 });
  return new Response(data.stream(), { headers });
}
