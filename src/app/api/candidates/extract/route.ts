import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { planExtraction, extractFromPlan } from "@/lib/extraction";
import { emptyExtractedFields } from "@/lib/extraction/types";
import { AI_INPUT_CHAR_CAP } from "@/lib/extraction/ai-fields";
import { recordAudit } from "@/app/(app)/audit-actions";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * PDF parsing plus a 20 second AI timeout has to fit inside whatever the host
 * allows a function. Nothing set it before, which meant the platform default.
 */
export const maxDuration = 60;

/**
 * Run extraction over an uploaded CV and return the pre-filled fields plus raw
 * text for the review form. Persists nothing: the recruiter confirms and edits
 * before the candidate is saved.
 *
 * When the document is not the TiPP template and GROQ_API_KEY is set, the
 * text also goes to Groq. That is a transfer of personal data out of the
 * country, so it is written to the audit trail before the call is made, not
 * after: the question the entry answers is "did this document leave", and it
 * left the moment the request was sent.
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
    const plan = await planExtraction(buffer, file.type, file.name);

    if (plan.willUseAi) {
      await recordAudit({
        action: "sent_for_ai_extraction",
        entityType: "cv_upload",
        entityLabel: file.name,
        detail: {
          chars: plan.rawText.length,
          truncated: plan.rawText.length > AI_INPUT_CHAR_CAP,
          provider: "groq",
        },
      });
    }

    const result = await extractFromPlan(plan, file.name);
    return NextResponse.json(result);
  } catch (e) {
    // Unsupported type or unreadable document: the form falls back to manual
    // entry. Logged, because an unreadable document and a crashed parser used
    // to be indistinguishable, and only one of them is the user's problem.
    console.error(`[extraction] ${file.name}:`, e instanceof Error ? e.message : e);
    return NextResponse.json({
      fields: emptyExtractedFields(),
      raw_text: "",
      engine: "local",
      no_text_found: true,
    });
  }
}
