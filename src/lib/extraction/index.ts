import "server-only";
import { extractDocumentText, extractDocumentTables } from "@/lib/extraction/text";
import { parseTextToFields, isTippCv, tippParsedFully } from "@/lib/extraction/local-parser";
import {
  emptyExtractedFields,
  type ExtractionResult,
  type ExtractedCandidateFields,
} from "@/lib/extraction/types";
import { isAiExtractionConfigured, extractWithAi } from "@/lib/extraction/ai-extractor";
import { mergeExtraction } from "@/lib/extraction/ai-fields";

export { isAiExtractionConfigured } from "@/lib/extraction/ai-extractor";

/**
 * What the orchestrator decided about a document before doing anything with
 * it, so the route can record that a CV is about to leave.
 */
export interface ExtractionPlan {
  rawText: string;
  tables: Awaited<ReturnType<typeof extractDocumentTables>>;
  /** The local parser's result. Always computed; it is the fallback and the base of any merge. */
  local: ExtractedCandidateFields;
  isTipp: boolean;
  /** True when the AI will actually be called for this document. */
  willUseAi: boolean;
}

/**
 * Read the document and decide the engine, without calling anything yet.
 *
 * Split from the extraction so the route can write an audit entry between
 * the decision and the call. The question that entry answers is "did this
 * document leave", and it left the moment the request was sent, so the
 * record has to exist before then, not after.
 */
export async function planExtraction(
  buffer: ArrayBuffer,
  mimeType: string,
  filename?: string,
): Promise<ExtractionPlan> {
  const [rawText, tables] = await Promise.all([
    extractDocumentText(buffer, mimeType, filename),
    extractDocumentTables(buffer, mimeType, filename),
  ]);
  const hasText = rawText.trim().length > 0;
  const local = hasText ? parseTextToFields(rawText, filename, tables) : emptyExtractedFields();
  const isTipp = hasText && isTippCv(rawText, tables);
  // A TiPP CV the template parser has read in full is sent nowhere: the
  // parser is exact and free and the AI could only be worse. One it has only
  // recognised, which a PDF of the template can be, is generic from here on,
  // and the header fields the parser did read still win the merge.
  const readLocally = isTipp && tippParsedFully(local);
  const willUseAi = isAiExtractionConfigured() && hasText && !readLocally;
  return { rawText, tables, local, isTipp, willUseAi };
}

/**
 * Extract candidate fields from an uploaded document.
 *
 * The local parser always runs first and is always the fallback. When the
 * document is not the TiPP template and GROQ_API_KEY is set, the model reads
 * it too and its answer is merged over the local result: identity and contact
 * stay local, everything semantic comes from the model. Any failure on the
 * AI side, from a timeout to a rate limit to an odd answer, falls back to the
 * local result with a note saying why, and the upload carries on. The
 * interface has been stable since before the AI existed, so nothing calling
 * this had to change.
 */
export async function extractFromDocument(
  buffer: ArrayBuffer,
  mimeType: string,
  filename?: string,
): Promise<ExtractionResult> {
  const plan = await planExtraction(buffer, mimeType, filename);
  return extractFromPlan(plan, filename);
}

export async function extractFromPlan(
  plan: ExtractionPlan,
  filename?: string,
): Promise<ExtractionResult> {
  const { rawText, local, willUseAi } = plan;

  if (rawText.trim().length === 0) {
    const fields = emptyExtractedFields();
    fields.full_name = filename ? filenameFallbackName(filename) : null;
    return {
      fields,
      raw_text: "",
      engine: "local",
      no_text_found: true,
    };
  }

  if (!willUseAi) {
    return { fields: local, raw_text: rawText, engine: "local", no_text_found: false };
  }

  const ai = await extractWithAi(rawText);

  if (!ai.ok) {
    // Said out loud in the log and in the result. A network call that
    // quietly degrades is the kind of thing that stays broken for a month.
    console.warn(`[extraction] AI unavailable for ${filename ?? "document"}: ${ai.reason}`);
    return {
      fields: local,
      raw_text: rawText,
      engine: "local",
      no_text_found: false,
      ai_note: `AI unavailable, local parser used: ${ai.reason}`,
    };
  }

  return {
    fields: mergeExtraction(local, ai.fields),
    raw_text: rawText,
    engine: "ai",
    no_text_found: false,
    ...(ai.truncated
      ? { ai_note: "The CV was longer than the AI could read in one go, so only the first part went to it. The local parser read all of it." }
      : {}),
  };
}

function filenameFallbackName(filename: string): string | null {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(cv|resume|curriculum vitae|final|updated|copy)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base || /\d/.test(base)) return null;
  const words = base.split(" ").filter(Boolean);
  return words.length >= 2 && words.length <= 4
    ? base
        .toLowerCase()
        .split(" ")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" ")
    : null;
}

export type { ExtractionResult, ExtractedCandidateFields } from "@/lib/extraction/types";
