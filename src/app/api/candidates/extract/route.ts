import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractFromDocument } from "@/lib/extraction";
import { emptyExtractedFields } from "@/lib/extraction/types";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Run the (free local) extraction engine over an uploaded CV and return the
 * pre-filled fields + raw text for the review form. Persists nothing — the
 * recruiter confirms/edits before the candidate is saved (plan Decision 2).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 10 MB limit." }, { status: 413 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const result = await extractFromDocument(buffer, file.type, file.name);
    return NextResponse.json(result);
  } catch {
    // Unsupported type or unreadable document — let the form fall back to manual.
    return NextResponse.json({
      fields: emptyExtractedFields(),
      raw_text: "",
      engine: "local",
      no_text_found: true,
    });
  }
}
