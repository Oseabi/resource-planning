/**
 * Tender documents are mostly boilerplate. A typical ZA government RFP is 45+
 * pages of standard bidding documents (SBD forms, General Conditions of
 * Contract, declarations, B-BBEE and tax forms) wrapped around a handful of
 * pages that actually describe the work.
 *
 * Dictionary-matching the whole file therefore produces mostly noise — "Tax
 * Compliance" and "Audit" from SBD forms, threshold amounts from the preference
 * points table. These helpers isolate the substantive part first.
 *
 * Pure and dependency-free; unit-tested in isolation.
 */

/** Repeated page furniture (running headers/footers) is dropped at this count. */
const REPEAT_THRESHOLD = 3;

/** Headings that mark the start of the substantive requirements. */
const CORE_START_PATTERNS = [
  /^terms of reference$/i,
  /^\d*\.?\s*scope of work\b/i,
  /^\d*\.?\s*(?:the\s+)?specifications?$/i,
  /^annexure\s+[a-z]\s*[-–:]?\s*(?:specifications?|terms of reference)/i,
  /^statement of work\b/i,
  /^\d*\.?\s*background and mandate\b/i,
  /^\d*\.?\s*project (?:scope|description|background)\b/i,
];

/** Boilerplate section headings — everything from here is standard-form text. */
const BOILERPLATE_PATTERNS = [
  /^sbd\s*\d/i,
  /^general conditions of contract\b/i,
  /^terms and conditions for bidding\b/i,
  /^declaration of interest\b/i,
  /^preference points claim form\b/i,
  /^central suppliers? database\b/i,
  /^invitation to bid\b/i,
  /^conditions of bid\b/i,
  /^pricing schedule\b/i,
  /^authority to sign\b/i,
  /^tax compliance\b/i,
];

/** Page-furniture lines that carry no information. */
function isPageFurniture(line: string): boolean {
  return (
    /^page\s+\d+\s+of\s+\d+$/i.test(line) ||
    /^\d+$/.test(line) ||
    line.length < 2
  );
}

/**
 * Remove running headers/footers — lines repeated on many pages. Keeps the first
 * occurrence so a repeated document title can still seed the tender title.
 */
export function stripRepeatedLines(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (isPageFurniture(line)) continue;
    const repeated = (counts.get(key) ?? 0) >= REPEAT_THRESHOLD;
    if (repeated) {
      if (seen.has(key)) continue; // keep only the first appearance
      seen.add(key);
    }
    out.push(line);
  }
  return out;
}

export interface TenderBody {
  /** Lines of the substantive section (or the whole document if none found). */
  core: string[];
  /** Whether a requirements section was actually identified. */
  foundCore: boolean;
  /** The full de-duplicated document, for fields that may appear in the preamble. */
  all: string[];
}

/**
 * Split a tender into its substantive body. Looks for a requirements heading
 * that appears after the standard-form block; if none is found the whole
 * document is returned, so short single-page RFQs keep working unchanged.
 */
export function tenderBody(text: string): TenderBody {
  const raw = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const all = stripRepeatedLines(raw);

  // Every candidate heading is scored by how much body it yields. A contents
  // page lists "Annexure C — Specifications" hundreds of lines before the real
  // section, so picking the first match would select an empty stub; the longest
  // resulting body is reliably the actual requirements.
  const starts: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const line = all[i];
    if (line.length > 60) continue; // a heading, not a sentence mentioning one
    if (CORE_START_PATTERNS.some((re) => re.test(line))) starts.push(i);
  }

  if (starts.length === 0) return { core: all, foundCore: false, all };

  const bodyFrom = (startIndex: number): string[] => {
    const core: string[] = [];
    for (let i = startIndex; i < all.length; i++) {
      const line = all[i];
      // Trim any standard-form annexure that follows the requirements.
      if (i > startIndex && line.length <= 60 && BOILERPLATE_PATTERNS.some((re) => re.test(line))) {
        break;
      }
      core.push(line);
    }
    return core;
  };

  let best: string[] = [];
  for (const start of starts) {
    const candidate = bodyFrom(start);
    if (candidate.length > best.length) best = candidate;
  }

  // Too small to be the real thing — fall back to the whole document.
  if (best.length < 20) return { core: all, foundCore: false, all };

  return { core: best, foundCore: true, all };
}
