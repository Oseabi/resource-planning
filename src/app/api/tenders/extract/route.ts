import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractDocumentText } from "@/lib/extraction/text";
import { parseRfqText, emptyTenderFields, type ExtractedTenderFields } from "@/lib/extraction/rfq-parser";
import { extractTenderWithGemini, geminiModel, isGeminiConfigured } from "@/lib/extraction/gemini";
import { mergeTenderExtraction } from "@/lib/extraction/tender-ai";
import { recordAudit } from "@/app/(app)/audit-actions";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** A long tender takes the model a while to read. */
export const maxDuration = 60;

export interface TenderExtraction {
  fields: ExtractedTenderFields;
  raw_text: string;
  no_text_found: boolean;
  /** Which engine produced the fields. */
  engine: "local" | "ai";
  /** Why the AI did not run, or what it had to do to. */
  ai_note?: string;
}

/**
 * Read an uploaded tender document into pre-filled fields for the review
 * form. Persists nothing: the user confirms and edits before the tender is
 * saved.
 *
 * The local parser always runs and is always the fallback. With
 * GEMINI_API_KEY set the document also goes to Gemini, as the PDF itself
 * where it is one, and the model's answer is laid over the local result. A
 * scanned PDF, which has no text for the local parser, still goes, because
 * the model reads the pages. Any failure on the AI side falls back to the
 * local result with a note saying why, and the upload carries on.
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

  const empty: TenderExtraction = { fields: emptyTenderFields(), raw_text: "", no_text_found: true, engine: "local" };

  try {
    const buffer = await file.arrayBuffer();
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const rawText = await extractDocumentText(buffer, file.type, file.name).catch(() => "");
    const hasText = rawText.trim().length > 0;
    const local = hasText ? parseRfqText(rawText, file.name) : emptyTenderFields();

    // Nothing to read and nobody to read it: the form falls back to manual entry.
    if (!hasText && !(isPdf && isGeminiConfigured())) return NextResponse.json(empty);

    if (!isGeminiConfigured()) {
      return NextResponse.json({ fields: local, raw_text: rawText, no_text_found: false, engine: "local" } satisfies TenderExtraction);
    }

    // Written before the call, not after: the question this entry answers is
    // "did this document leave", and it left the moment the request went.
    await recordAudit({
      action: "sent_tender_for_ai_extraction",
      entityType: "tender_upload",
      entityLabel: file.name,
      detail: { bytes: file.size, chars: rawText.length, provider: "gemini", model: geminiModel(), as_pdf: isPdf },
    });

    const ai = await extractTenderWithGemini({ text: rawText, pdf: isPdf ? Buffer.from(buffer) : null, filename: file.name });

    if (!ai.ok) {
      // Said out loud in the log and in the result. A network call that
      // quietly degrades is the kind of thing that stays broken for a month.
      console.warn(`[tender extraction] AI unavailable for ${file.name}: ${ai.reason}`);
      return NextResponse.json({
        fields: local,
        raw_text: rawText,
        no_text_found: !hasText,
        engine: "local",
        ai_note: `AI unavailable, local parser used: ${ai.reason}`,
      } satisfies TenderExtraction);
    }

    const notes = [
      ai.truncated ? "The document was longer than the AI could read in one go, so only the first part went to it." : null,
      ai.note ?? null,
    ].filter((n): n is string => n !== null);

    return NextResponse.json({
      fields: mergeTenderExtraction(local, ai.fields),
      raw_text: rawText,
      no_text_found: !hasText,
      engine: "ai",
      ...(notes.length > 0 ? { ai_note: notes.join(" ") } : {}),
    } satisfies TenderExtraction);
  } catch (e) {
    console.error(`[tender extraction] ${file.name}:`, e instanceof Error ? e.message : e);
    return NextResponse.json(empty);
  }
}
