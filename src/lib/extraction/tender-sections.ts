/**
 * Tender documents are mostly boilerplate. A typical ZA government RFP is 45+
 * pages of standard bidding documents (SBD forms, General Conditions of
 * Contract, declarations, B-BBEE and tax forms) wrapped around a handful of
 * pages that actually describe the work.
 *
 * Dictionary-matching the whole file therefore produces mostly noise, "Tax
 * Compliance" and "Audit" from SBD forms, threshold amounts from the preference
 * points table. These helpers isolate the substantive part first.
 *
 * Pure and dependency-free; unit-tested in isolation.
 */

/** Repeated page furniture (running headers/footers) is dropped at this count. */
const REPEAT_THRESHOLD = 3;

/**
 * Headings that mark the start of the substantive requirements. Matched against
 * the heading text after section numbering has been stripped, so "3.1. SCOPE OF
 * WORK" and "SCOPE OF WORK" behave identically.
 */
const CORE_START_PATTERNS = [
  /^terms of reference\b/i,
  /^scope of work\b/i,
  /^(?:the\s+)?specifications?$/i,
  /^annexure\s+[a-z]\s*[-–:]?\s*(?:specifications?|terms of reference)/i,
  /^statement of work\b/i,
  /^background(?:\s+and\s+mandate)?$/i,
  /^project (?:scope|description|background)\b/i,
  /^functional requirements?\b/i,
];

/** Boilerplate section headings, everything from here is standard-form text. */
const BOILERPLATE_PATTERNS = [
  /^sbd\s*\d/i,
  /^general conditions of contract\b/i,
  /^special conditions of contract\b/i,
  /^terms and conditions for bidding\b/i,
  /^declaration of interest\b/i,
  /^preference points claim form\b/i,
  /^central suppliers? database\b/i,
  /^invitation to bid\b/i,
  /^conditions of bid\b/i,
  /^pricing schedule\b/i,
  /^authority to sign\b/i,
  /^tax compliance\b/i,
  /^sbd forms?\b/i,
  /^returnable (?:documents|schedules)\b/i,
  /^stage\s*\d*\s*:?\s*returnable/i,
  /^guide to responses?\b/i,
];

/**
 * A contents-page entry rather than the section itself. These carry dot leaders
 * or a trailing page reference, and appear long before the real heading, so
 * matching one would anchor the body in the wrong place.
 */
function isContentsEntry(line: string): boolean {
  return (
    /\.{3,}/.test(line) || // "SCOPE OF WORK ............ 3"
    /\b\d+\s+of\s+\d+\s*$/i.test(line) || // "Terms of Reference 04 of 52"
    /\s{2,}\d{1,3}$/.test(line)
  );
}

/** Strip section numbering ("3.1.", "1.4.1") so headings compare cleanly. */
function headingText(line: string): string {
  return line
    .replace(/^[\s•·]*\d+(?:\.\d+)*\.?\s+/, "")
    .replace(/[\s.:]+$/, "")
    .trim();
}

/** Page-furniture lines that carry no information. */
function isPageFurniture(line: string): boolean {
  return (
    /^page\s+\d+\s+of\s+\d+$/i.test(line) ||
    /^\d+$/.test(line) ||
    line.length < 2
  );
}

/**
 * Remove running headers/footers, lines repeated on many pages. Keeps the first
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

/**
 * Lines that repeat across pages, most frequent first.
 *
 * These are the running headers and footers, and they are the single most
 * reliable place to find the issuing authority: a bid document prints its
 * owner's name on every page, whereas the cover page phrases it a different way
 * in every tender. stripRepeatedLines already computes this in order to discard
 * it; this exposes the same signal for the parser to read instead.
 */
export function repeatedLines(lines: string[], minCount = REPEAT_THRESHOLD): string[] {
  const counts = new Map<string, { count: number; text: string }>();

  for (const line of lines) {
    const text = line.trim();
    const key = text.toLowerCase();
    if (!key || isPageFurniture(line)) continue;
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { count: 1, text });
  }

  return [...counts.values()]
    .filter((e) => e.count >= minCount)
    .sort((a, b) => b.count - a.count || b.text.length - a.text.length)
    .map((e) => e.text);
}

export interface TenderBody {
  /**
   * Every line, before repeated headers and footers were collapsed. The
   * repetition is itself a signal, since it identifies the issuing authority,
   * so it has to survive for the parser to read.
   */
  raw: string[];
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
  // page lists "Annexure C, Specifications" hundreds of lines before the real
  // section, so picking the first match would select an empty stub; the longest
  // resulting body is reliably the actual requirements.
  const starts: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const line = all[i];
    if (line.length > 70) continue; // a heading, not a sentence mentioning one
    if (isContentsEntry(line)) continue;
    if (CORE_START_PATTERNS.some((re) => re.test(headingText(line)))) starts.push(i);
  }

  if (starts.length === 0) return { core: all, foundCore: false, all, raw };

  const bodyFrom = (startIndex: number): string[] => {
    const core: string[] = [];
    for (let i = startIndex; i < all.length; i++) {
      const line = all[i];
      // Trim any standard-form annexure that follows the requirements.
      if (
        i > startIndex &&
        line.length <= 70 &&
        !isContentsEntry(line) &&
        BOILERPLATE_PATTERNS.some((re) => re.test(headingText(line)))
      ) {
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

  // Too small to be the real thing, fall back to the whole document.
  if (best.length < 20) return { core: all, foundCore: false, all, raw };

  return { core: best, foundCore: true, all, raw };
}
