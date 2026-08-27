/**
 * Split raw CV text into labelled sections by detecting common headings.
 * Pure and dependency-free, safe to unit-test in isolation.
 */

export type SectionName =
  | "summary"
  | "skills"
  | "technical_skills"
  | "experience"
  | "education"
  | "certifications"
  | "languages"
  | "achievements"
  | "projects"
  | "other"
  | "references";

export interface SplitSections {
  /** Text above the first recognised heading (usually name + contact block). */
  preamble: string;
  sections: Partial<Record<SectionName, string>>;
}

/** Heading keywords → canonical section. Order matters: more specific first. */
const HEADING_MATCHERS: { name: SectionName; patterns: RegExp[] }[] = [
  {
    name: "technical_skills",
    patterns: [
      /^technical skills?\b/i,
      /^technical (?:proficienc|competenc|tools?|expertise)/i,
      /^technologies\b/i,
      /^tech stack\b/i,
      /^tools? (?:&|and) technolog/i,
      /^systems? (?:&|and) tools?\b/i,
    ],
  },
  {
    name: "skills",
    patterns: [
      /^(?:key |core )?skills?\b/i,
      /^core competenc/i,
      /^(?:areas? of )?expertise\b/i,
      /^competenc/i,
      /^proficienc/i,
      /^capabilit/i,
      /^strengths?\b/i,
    ],
  },
  {
    name: "summary",
    patterns: [
      // "EXECUTIVE SUMMARY", "CAREER SUMMARY", "PROFESSIONAL SUMMARY", "SUMMARY"
      /^(?:executive|career|professional|personal)?\s*summary\b/i,
      /^(?:professional |personal |career )?profile\b/i,
      /^personal statement\b/i,
      /^(?:career )?objective\b/i,
      /^about(?: me)?\b/i,
      /^(?:professional )?overview\b/i,
      /^introduction\b/i,
    ],
  },
  {
    name: "achievements",
    patterns: [
      /^(?:key |selected |notable |career )*achievements?\b/i,
      /^(?:key |selected )?accomplishments?\b/i,
      /^career highlights?\b/i,
      /^highlights?\b/i,
      /^(?:awards?|prizes?)\b/i,
      /^awards? (?:&|and) recognition\b/i,
    ],
  },
  {
    name: "experience",
    patterns: [
      // Leading qualifiers cover "EARLIER EXPERIENCES", "ADDITIONAL EXPERIENCE",
      // and typo'd variants like "EARLIER EXPERINCES" (prefix match on "experi").
      /^(?:work |professional |employment |earlier |previous |additional |other |relevant |career )*experi/i,
      /^employment (?:history|record)\b/i,
      /^work history\b/i,
      /^career history\b/i,
    ],
  },
  {
    name: "education",
    patterns: [
      /^education\b/i,
      /^academic (?:background|qualification|history|record)/i,
      /^qualifications?\b/i,
      /^studies\b/i,
    ],
  },
  {
    name: "certifications",
    patterns: [
      /^certifications?\b/i,
      /^certificates?\b/i,
      /^licen[cs]es?\b/i,
      /^accreditations?\b/i,
      /^professional development\b/i,
      /^courses?\b/i,
      /^training\b/i,
    ],
  },
  {
    name: "languages",
    patterns: [/^languages?\b/i],
  },
  {
    // Anchored, so "PROJECT EXPERIENCE" stays employment history rather than
    // being diverted here.
    name: "projects",
    patterns: [
      /^(?:key |selected |personal |side |notable |featured |academic )*projects?$/i,
      /^portfolio$/i,
    ],
  },
  {
    // Nothing reads these. They exist so a heading the splitter does not know
    // stops the section above it. One CV wrote its skills list directly above
    // PROJECTS, and with no match for that word the entire projects section was
    // read as skills: the candidate came back with 66 of them, among them
    // "supporting multiple chat rooms" and a github.com URL.
    name: "other",
    patterns: [
      /^(?:personal |additional |other )?(?:interests?|hobbies)\b/i,
      /^publications?\b/i,
      /^(?:professional )?(?:memberships?|affiliations?|associations?)\b/i,
      /^personal (?:details|information|particulars)\b/i,
      /^(?:additional|other|further) information\b/i,
      /^declaration\b/i,
      /^extra[- ]?curricular\b/i,
      /^(?:community )?(?:volunteer|voluntary)/i,
      /^availability\b/i,
    ],
  },
  {
    name: "references",
    patterns: [/^refer(?:en|n)ces?\b/i, /^referees?\b/i],
  },
];

/** Split a heading like "Education & Certifications" into its parts. */
function headingParts(heading: string): string[] {
  return heading
    .split(/\s*(?:&|\+|\/|,|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

function matchSingle(text: string): SectionName | null {
  for (const matcher of HEADING_MATCHERS) {
    if (matcher.patterns.some((re) => re.test(text))) return matcher.name;
  }
  return null;
}

/**
 * Sections a heading line maps to. Returns several for combined headings such as
 * "EDUCATION & CERTIFICATIONS", so the block feeds both parsers.
 */
/**
 * Undo letter-spaced headings, "W O R K - E X P E R I E N C E".
 *
 * Tracking a heading out is a common CV design, and the extracted text keeps
 * the spaces, so the heading never matches and the section is lost. One real CV
 * yielded no work history, no education and no summary for exactly this reason:
 * not one of its sections was recognised.
 *
 * Only collapsed when nearly every token is a single character, which prose and
 * ordinary headings never are.
 */
export function collapseLetterSpacing(line: string): string {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4) return line;

  const singles = tokens.filter((t) => t.length === 1).length;
  if (singles < tokens.length * 0.8) return line;

  // The separator between words survives as its own token, so it becomes the
  // word break once the letters are joined.
  return tokens
    .join("")
    .replace(/[-–—_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchHeading(line: string): SectionName[] {
  const trimmed = collapseLetterSpacing(line)
    .trim()
    .replace(/^[\s\-–—*•·▪◦‣∙]+/, "")
    .replace(/[:\s]+$/, "")
    .trim();

  if (trimmed.length === 0 || trimmed.length > 45) return [];
  // Headings rarely end in sentence punctuation or run on like prose.
  if (/[.!?]$/.test(trimmed)) return [];
  if (trimmed.split(/\s+/).length > 6) return [];

  const whole = matchSingle(trimmed);
  const parts = headingParts(trimmed);

  // Combined heading: every part must independently look like a section.
  if (parts.length > 1) {
    const mapped = parts.map(matchSingle);
    if (mapped.every((m): m is SectionName => m !== null)) {
      return Array.from(new Set(mapped));
    }
  }

  return whole ? [whole] : [];
}

export function splitSections(text: string): SplitSections {
  const lines = text.split(/\r?\n/);
  const sections: Partial<Record<SectionName, string>> = {};
  const preambleLines: string[] = [];

  let current: SectionName[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join("\n").trim();
    if (current.length && joined) {
      for (const name of current) {
        const existing = sections[name];
        sections[name] = existing ? `${existing}\n${joined}` : joined;
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading.length) {
      flush();
      current = heading;
      continue;
    }
    if (current.length) {
      buffer.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  flush();

  return { preamble: preambleLines.join("\n").trim(), sections };
}
