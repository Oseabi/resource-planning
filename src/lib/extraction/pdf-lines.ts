/**
 * Rebuild line structure from a PDF's positioned text items.
 *
 * unpdf's `extractText(..., { mergePages: true })` returns the whole document as
 * a single space-joined string with no newlines, which defeats every line-based
 * heuristic downstream (headings, experience entries, education rows). pdf.js
 * exposes each text run with a transform matrix, so we can group runs that share
 * a baseline into real lines and recover the document's visual structure.
 *
 * Pure apart from the pdf.js proxy it is handed — unit-tested via `groupItemsIntoLines`.
 */

/** The subset of a pdf.js `TextItem` we rely on. */
export interface PositionedTextItem {
  str: string;
  /** pdf.js transform matrix; [4] = x, [5] = y (baseline). */
  transform: number[];
  width?: number;
  /** pdf.js sets this when the run ends a line. */
  hasEOL?: boolean;
}

/** Runs whose baselines differ by less than this are treated as the same line. */
const BASELINE_TOLERANCE = 2.5;
/** Horizontal gap (in text units) that implies a word break between runs. */
const WORD_GAP = 0.8;

interface Row {
  y: number;
  items: { x: number; str: string; width: number }[];
}

/**
 * Group positioned text runs into visually-ordered lines (top to bottom, then
 * left to right). Exported for testing.
 */
export function groupItemsIntoLines(items: PositionedTextItem[]): string[] {
  const rows: Row[] = [];

  for (const item of items) {
    if (typeof item?.str !== "string" || item.str.length === 0) continue;
    const transform = item.transform;
    if (!Array.isArray(transform) || transform.length < 6) continue;
    const x = transform[4];
    const y = transform[5];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    let row = rows.find((r) => Math.abs(r.y - y) <= BASELINE_TOLERANCE);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, str: item.str, width: Number.isFinite(item.width) ? (item.width as number) : 0 });
  }

  rows.sort((a, b) => b.y - a.y); // PDF origin is bottom-left, so higher y is higher up.

  return rows
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let line = "";
      let prevEnd: number | null = null;
      for (const item of row.items) {
        if (prevEnd !== null) {
          const gap = item.x - prevEnd;
          if (gap > WORD_GAP && !line.endsWith(" ") && !item.str.startsWith(" ")) line += " ";
        }
        line += item.str;
        prevEnd = item.x + item.width;
      }
      return normaliseLine(line);
    })
    .filter((line) => line.length > 0);
}

/**
 * Collapse runs of whitespace and normalise the punctuation PDF exports mangle
 * (non-breaking hyphens, figure dashes, smart quotes) so downstream regexes and
 * dictionary matching behave predictably.
 */
export function normaliseLine(line: string): string {
  return line
    .replace(/ /g, " ")
    .replace(/[‐‑‒–—−]/g, (m) => (m === "–" || m === "—" ? m : "-"))
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal structural surface of the pdf.js document proxy we need. */
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
}

/**
 * Extract a PDF's text with line structure preserved. Pages are separated by a
 * blank line so section detection can't bleed across page boundaries.
 */
export async function extractPdfTextWithLines(pdf: PdfDocumentLike): Promise<string> {
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = (content.items ?? []).filter(
      (item): item is PositionedTextItem =>
        typeof item === "object" && item !== null && "str" in item && "transform" in item,
    );
    const lines = groupItemsIntoLines(items);
    if (lines.length) pages.push(lines.join("\n"));
  }

  return pages.join("\n\n");
}
