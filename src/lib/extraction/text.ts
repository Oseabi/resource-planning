import "server-only";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { extractPdfTextWithLines, type PdfDocumentLike } from "@/lib/extraction/pdf-lines";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Read plain text from a supported document buffer.
 *  - PDF (text-based) via unpdf
 *  - Word .docx via mammoth
 * Scanned/image PDFs return empty text (no free OCR in scope) — the caller then
 * falls back to manual entry.
 */
export async function extractDocumentText(
  buffer: ArrayBuffer,
  mimeType: string,
  filename?: string,
): Promise<string> {
  const isPdf = mimeType === "application/pdf" || filename?.toLowerCase().endsWith(".pdf");
  const isDocx = mimeType === DOCX_MIME || filename?.toLowerCase().endsWith(".docx");

  if (isPdf) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));

    // Preferred: rebuild real lines from text-item positions. `mergePages` flattens
    // the whole document into one line, which defeats all line-based parsing.
    try {
      const lined = await extractPdfTextWithLines(pdf as unknown as PdfDocumentLike);
      if (lined.trim().length > 0) return lined;
    } catch {
      // Fall through to the flat extractor below.
    }

    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  }

  if (isDocx) {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return result.value;
  }

  throw new Error(`Unsupported document type: ${mimeType || filename || "unknown"}`);
}
