import "server-only";
import { extractDocumentText } from "@/lib/extraction/text";
import { parseTextToFields } from "@/lib/extraction/local-parser";
import { emptyExtractedFields, type ExtractionResult } from "@/lib/extraction/types";

/** Whether the paid Claude extraction path is enabled (plan Decision 10). */
export function isAiExtractionEnabled(): boolean {
  return process.env.AI_EXTRACTION_ENABLED === "true";
}

/**
 * Extract candidate/RFQ fields from an uploaded document.
 *
 * Default engine is the free local parser (unpdf/mammoth + heuristics). When
 * AI_EXTRACTION_ENABLED=true, the AI engine takes over — not yet implemented, so
 * we currently always use local. The interface is stable so the AI path can slot
 * in without touching callers.
 */
export async function extractFromDocument(
  buffer: ArrayBuffer,
  mimeType: string,
  filename?: string,
): Promise<ExtractionResult> {
  // AI path intentionally not wired yet (no budget); falls through to local.
  // if (isAiExtractionEnabled()) return extractWithAi(buffer, mimeType, filename);

  const rawText = await extractDocumentText(buffer, mimeType, filename);
  const trimmed = rawText.trim();

  if (trimmed.length === 0) {
    const fields = emptyExtractedFields();
    fields.full_name = filename ? filenameFallbackName(filename) : null;
    return {
      fields,
      raw_text: "",
      engine: "local",
      no_text_found: true,
    };
  }

  return {
    fields: parseTextToFields(rawText, filename),
    raw_text: rawText,
    engine: "local",
    no_text_found: false,
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
