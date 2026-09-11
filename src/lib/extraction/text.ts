import "server-only";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { extractPdfTextWithLines, type PdfDocumentLike } from "@/lib/extraction/pdf-lines";
import { tablesFromHtml, type DocumentTables } from "@/lib/extraction/docx-tables";
import { tablesFromPdfPages, pdfItemsFrom, type PdfPageItems } from "@/lib/extraction/pdf-tables";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * pdf.js hands the bytes it is given to its worker by transfer, which
 * detaches them from the caller. The text and the tables of one upload are
 * read from the same buffer at the same time, so each reader gets its own
 * copy, or the second one finds an empty buffer and reads nothing.
 */
function copyOf(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
}

/**
 * Read plain text from a supported document buffer.
 *  - PDF (text-based) via unpdf
 *  - Word .docx via mammoth
 * Scanned/image PDFs return empty text (no free OCR in scope), the caller then
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
    const pdf = await getDocumentProxy(copyOf(buffer));

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

/** What a document's tables came with, beyond the tables themselves. */
export interface DocumentTablesResult {
  tables: DocumentTables;
  /** The cover page's "As of date", when the document had one. */
  coverAsOf: string | null;
}

/**
 * A document's tables, or an empty list for anything else.
 *
 * The TiPP Focus CV is entirely tables, and reading them directly avoids
 * reconstructing rows from flattened text, which is where that parser's worst
 * failures come from. A .docx yields them through mammoth. A PDF yields them
 * from the position of every run of text, which is the only place a PDF keeps
 * its columns, and which the plain text reader throws away.
 */
export async function extractDocumentTables(
  buffer: ArrayBuffer,
  mimeType: string,
  filename?: string,
): Promise<DocumentTables> {
  return (await extractDocumentTablesWithMeta(buffer, mimeType, filename)).tables;
}

export async function extractDocumentTablesWithMeta(
  buffer: ArrayBuffer,
  mimeType: string,
  filename?: string,
): Promise<DocumentTablesResult> {
  const isPdf = mimeType === "application/pdf" || filename?.toLowerCase().endsWith(".pdf");
  const isDocx = mimeType === DOCX_MIME || filename?.toLowerCase().endsWith(".docx");

  try {
    if (isDocx) {
      const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(buffer) });
      return { tables: tablesFromHtml(value), coverAsOf: null };
    }
    if (isPdf) {
      const pdf = await getDocumentProxy(copyOf(buffer));
      const pages: PdfPageItems[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const { items } = await page.getTextContent();
        pages.push({ items: pdfItemsFrom(items as unknown[]) });
      }
      const result = tablesFromPdfPages(pages);
      return { tables: result.tables, coverAsOf: result.coverAsOf };
    }
  } catch (e) {
    // A document that cannot be read as tables still parses from its text,
    // but said out loud: a reader that fails silently is indistinguishable
    // from a document with no tables, and the template parser then reads
    // the header and nothing else.
    console.warn(
      `[extraction] could not read the tables of ${filename ?? "document"}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return { tables: [], coverAsOf: null };
}
