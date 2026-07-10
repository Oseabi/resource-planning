import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractDocumentText } from "@/lib/extraction/text";
import { parseRfqText, emptyTenderFields } from "@/lib/extraction/rfq-parser";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Run the free local RFQ/RFI parser over an uploaded document and return
 * pre-filled tender fields + raw text for the review form. Persists nothing —
 * the user confirms/edits before the tender is saved (plan Decision 2).
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
    const rawText = await extractDocumentText(buffer, file.type, file.name);
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ fields: emptyTenderFields(), raw_text: "", no_text_found: true });
    }
    return NextResponse.json({
      fields: parseRfqText(rawText, file.name),
      raw_text: rawText,
      no_text_found: false,
    });
  } catch {
    return NextResponse.json({ fields: emptyTenderFields(), raw_text: "", no_text_found: true });
  }
}
