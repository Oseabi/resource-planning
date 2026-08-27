/**
 * Recover a Word document's tables as rows and cells.
 *
 * The TiPP Focus CV is entirely tables, and reading it from flattened text
 * means reconstructing those tables by guessing where one row ends and the next
 * begins. That guessing is the source of the parser's worst failures: a
 * qualification with no year merges into the row below it, and a career table
 * whose dates are written in an unexpected format collapses into prose.
 *
 * mammoth can emit HTML instead, which preserves the table structure exactly,
 * so an empty cell stays an empty cell rather than disappearing. Working from
 * that removes the guessing rather than improving it.
 *
 * Pure and dependency-free: takes HTML, returns cells. The mammoth call lives
 * in text.ts, which is server-only.
 */

/** A document's tables: table, then row, then cell text. */
export type DocumentTables = string[][][];

const TABLE_RE = /<table[^>]*>[\s\S]*?<\/table>/g;
const ROW_RE = /<tr[^>]*>[\s\S]*?<\/tr>/g;
const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * The text of one cell, with its paragraphs kept as separate lines.
 *
 * The line breaks matter: a duties cell holds one bullet per paragraph, and a
 * skills cell holds one skill per paragraph, so flattening them to a single
 * string would merge entries that need to stay apart.
 */
export function cellText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(?:p|div|li)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((line) => line.replace(/ /g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Every table in the document, as rows of cell text. */
export function tablesFromHtml(html: string): DocumentTables {
  const tables: DocumentTables = [];

  for (const table of html.match(TABLE_RE) ?? []) {
    // Nested tables would otherwise have their rows counted twice, once here
    // and once inside the parent. Word rarely nests, but a stray one would
    // silently double a candidate's job history.
    const inner = table.slice(table.indexOf(">") + 1, table.lastIndexOf("<"));
    const withoutNested = inner.replace(TABLE_RE, "");

    const rows: string[][] = [];
    for (const row of withoutNested.match(ROW_RE) ?? []) {
      const cells: string[] = [];
      for (const cell of row.matchAll(CELL_RE)) cells.push(cellText(cell[1]));
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }

  return tables;
}

/** True when a row has no content at all, which Word leaves behind freely. */
export function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}
