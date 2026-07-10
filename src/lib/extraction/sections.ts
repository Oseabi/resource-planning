/**
 * Split raw CV text into labelled sections by detecting common headings.
 * Pure and dependency-free — safe to unit-test in isolation.
 */

export type SectionName =
  | "summary"
  | "skills"
  | "technical_skills"
  | "experience"
  | "education"
  | "certifications"
  | "languages";

export interface SplitSections {
  /** Text above the first recognised heading (usually name + contact block). */
  preamble: string;
  sections: Partial<Record<SectionName, string>>;
}

/** Heading keywords → canonical section. Order matters: more specific first. */
const HEADING_MATCHERS: { name: SectionName; patterns: RegExp[] }[] = [
  {
    name: "technical_skills",
    patterns: [/^technical skills?\b/i, /^technical (?:proficienc|competenc)/i, /^technologies\b/i, /^tech stack\b/i, /^tools? (?:&|and) technolog/i],
  },
  {
    name: "skills",
    patterns: [/^(?:key )?skills?\b/i, /^core competenc/i, /^areas of expertise\b/i, /^competenc/i, /^proficienc/i],
  },
  {
    name: "summary",
    patterns: [/^professional summary\b/i, /^summary\b/i, /^profile\b/i, /^professional profile\b/i, /^personal statement\b/i, /^objective\b/i, /^about (?:me)?\b/i],
  },
  {
    name: "experience",
    patterns: [/^(?:work |professional |employment )?experience\b/i, /^employment (?:history|record)\b/i, /^work history\b/i, /^career (?:history|summary)\b/i],
  },
  {
    name: "education",
    patterns: [/^education\b/i, /^academic (?:background|qualification|history)\b/i, /^qualifications?\b/i],
  },
  {
    name: "certifications",
    patterns: [/^certifications?\b/i, /^certificates?\b/i, /^licen[cs]es?\b/i, /^accreditations?\b/i, /^professional development\b/i, /^courses?\b/i],
  },
  {
    name: "languages",
    patterns: [/^languages?\b/i],
  },
];

/** A heading line is short, not sentence-like, and matches a known pattern. */
function matchHeading(line: string): SectionName | null {
  const trimmed = line.trim().replace(/[:\s]+$/, "");
  if (trimmed.length === 0 || trimmed.length > 40) return null;
  // Headings rarely end with a period or contain many words of prose.
  if (/[.!?]$/.test(trimmed)) return null;
  for (const matcher of HEADING_MATCHERS) {
    if (matcher.patterns.some((re) => re.test(trimmed))) return matcher.name;
  }
  return null;
}

export function splitSections(text: string): SplitSections {
  const lines = text.split(/\r?\n/);
  const sections: Partial<Record<SectionName, string>> = {};
  const preambleLines: string[] = [];

  let current: SectionName | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      const existing = sections[current];
      const joined = buffer.join("\n").trim();
      sections[current] = existing ? `${existing}\n${joined}` : joined;
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = matchHeading(line);
    if (heading) {
      flush();
      current = heading;
      continue;
    }
    if (current) {
      buffer.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  flush();

  return { preamble: preambleLines.join("\n").trim(), sections };
}
