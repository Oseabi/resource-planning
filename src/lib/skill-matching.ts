/**
 * Does what a candidate holds satisfy what a seat asks for.
 *
 * Until this module existed, scoring compared skills as exact text after only
 * lowercasing: "D365 Finance and Operations" scored zero against a seat asking
 * for "Microsoft Dynamics 365 F&O", and "Java 8" missed "Java". Skills are 25
 * of the 100 points and certifications another 20, so spelling alone decided
 * who reached the shortlist.
 *
 * Four layers, first hit wins, deliberately in this order:
 *
 *   exact    the same words            full credit
 *   alias    the same thing, written   full credit
 *            another way
 *   version  the same technology, a    full credit
 *            different release
 *   near     the candidate's term is   partial credit
 *            broader than the seat's
 *
 * There is no edit distance, no substring and no phonetics. This runs in the
 * browser as well as on the server, and more importantly its result has to be
 * defensible to a bid manager reading the breakdown panel. "Microsoft Dynamics
 * 365 F&O covers Dynamics 365" is an argument; "these two strings are three
 * characters apart" is not.
 *
 * Pure and synchronous, with no server-only import, because scoring.ts runs
 * identically on both sides and the breakdown panel re-runs it client-side to
 * name which skills matched.
 */

import { ALIAS_GROUPS, type AliasGroup } from "@/lib/skill-aliases";

/** How a requirement was satisfied, in descending order of confidence. */
export type MatchQuality = "exact" | "alias" | "version" | "near" | "none";

/**
 * What a broader candidate term is worth against a narrower requirement.
 *
 * Not full credit: "Dynamics 365" is evidence for a seat asking for "Dynamics
 * 365 F&O" but it is not the same claim, and a 100 on the breakdown panel has
 * to mean the person literally holds everything asked for. Not zero either,
 * which is the bug this module exists to fix.
 */
export const NEAR_MATCH_CREDIT = 0.6;

/** Words that carry no meaning when deciding whether one term covers another. */
const STOPWORDS = new Set(["and", "of", "the", "for", "in", "a", "on", "with", "to"]);

/**
 * How much longer a candidate's term may be than the requirement it answers.
 *
 * The point of a near match is that the candidate's term is a more specific
 * version of what the seat asked for, and a specific version is a word or two
 * longer, not a sentence. Without this, "Business Architecture" was satisfied
 * by "Sherwoord Advanced Business Security Architecture (SABSA) Foundation",
 * which is a security qualification that happens to contain both words, and by
 * a stray CV bullet that had been extracted as a skill. Both appeared in the
 * first run against real data.
 *
 * Three keeps every case this layer exists for, including "Microsoft Dynamics
 * 365 F&O" answering "Dynamics 365", which sits exactly on the limit.
 */
const MAX_EXTRA_TOKENS = 3;

/**
 * One spelling, reduced to something comparable.
 *
 * The character allowlist is the load-bearing choice. Stripping punctuation
 * wholesale collapses C#, C++ and C to "c", which manufactures false positives
 * in the exact language list this business bids on, so +, # and . survive and
 * everything else becomes a space. That keeps .net, c#, x++ and node.js
 * distinct while letting "Finance & Operations" meet "Finance and Operations".
 */
export function fold(value: string): string {
  // Postgres allows a null element inside a not-null text[], and the database
  // accepts one today, so a single bad row would otherwise throw and take the
  // whole matching run down with it. A skill that is not a string is no skill.
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’“”]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * A fold with a trailing release number taken off, so that a technology and
 * one of its versions compare equal.
 *
 * A version is one or two bare digits, or a dotted number, optionally with a
 * leading "v". Three or more bare digits are kept, and that single guard is
 * what makes the rule safe: without it "Dynamics 365" becomes "dynamics",
 * "Office 365" becomes "office", and "ISO 27001" collides with "ISO 9001".
 */
export function baseKey(value: string): string {
  const folded = fold(value);
  return folded.replace(/\s+v?(?:\d{1,2}|\d+\.\d+(?:\.\d+)*)$/, "").trim() || folded;
}

/** The meaningful words of a term, stopwords dropped. */
function tokensOf(value: string): string[] {
  return baseKey(value)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

// Built once at module load. A form appearing in two groups is DROPPED rather
// than merged, so a bad edit degrades to "no alias" instead of declaring two
// unrelated things equal. validateAliases is what makes that visible, and a
// test fails the build on it.
const GROUP_BY_FORM: Map<string, number> = (() => {
  const index = new Map<string, number>();
  const seen = new Set<string>();
  ALIAS_GROUPS.forEach((group, id) => {
    for (const form of [group.canonical, ...group.aliases]) {
      const key = fold(form);
      if (!key) continue;
      if (seen.has(key)) {
        index.delete(key);
        continue;
      }
      seen.add(key);
      index.set(key, id);
    }
  });
  return index;
})();

/** The alias group a spelling belongs to, or null when the table has no opinion. */
export function aliasGroupOf(value: string): number | null {
  return GROUP_BY_FORM.get(fold(value)) ?? null;
}

/** Whether two spellings are the same thing according to the table. */
export function aliasEqual(a: string, b: string): boolean {
  const ga = aliasGroupOf(a);
  return ga !== null && ga === aliasGroupOf(b);
}

/**
 * Everything wrong with an alias table, as a list of sentences, empty when it
 * is sound. Shaped like isStrictSchema in the extraction module: a problem is
 * described, not thrown, so one test can assert the real table is clean and
 * another can assert a broken one is caught.
 */
export function validateAliases(groups: AliasGroup[], known?: string[]): string[] {
  const problems: string[] = [];
  const owner = new Map<string, string>();
  const knownSet = known ? new Set(known.map(fold)) : null;

  for (const group of groups) {
    if (!group.canonical.trim()) {
      problems.push("A group has no canonical spelling.");
      continue;
    }
    if (knownSet && !knownSet.has(fold(group.canonical))) {
      problems.push(
        `"${group.canonical}" is not in the system's vocabulary. Add it there, or alias it to a term that is.`,
      );
    }
    const withinGroup = new Set<string>();
    for (const form of [group.canonical, ...group.aliases]) {
      const key = fold(form);
      if (!key) {
        problems.push(`"${group.canonical}" has a blank spelling in its list.`);
        continue;
      }
      if (withinGroup.has(key)) {
        problems.push(`"${group.canonical}" lists "${form}" twice.`);
        continue;
      }
      withinGroup.add(key);
      const existing = owner.get(key);
      if (existing && existing !== group.canonical) {
        problems.push(`"${form}" is claimed by both "${existing}" and "${group.canonical}".`);
        continue;
      }
      owner.set(key, group.canonical);
    }
  }
  return problems;
}

/**
 * A candidate's terms, prepared once so a run does not re-fold them per seat.
 *
 * Matching scores every candidate against every seat against every required
 * item, so at a few hundred people and ten seats the inner comparison runs
 * tens of millions of times. The three full-credit layers become set lookups,
 * and the token set gates the only layer that has to walk the list.
 */
export interface CandidateIndex {
  exact: Set<string>;
  base: Set<string>;
  groups: Set<number>;
  tokens: Set<string>;
  items: { raw: string; tokens: string[] }[];
}

export function buildCandidateIndex(values: string[]): CandidateIndex {
  const index: CandidateIndex = {
    exact: new Set(),
    base: new Set(),
    groups: new Set(),
    tokens: new Set(),
    items: [],
  };
  for (const value of values) {
    const folded = fold(value);
    if (!folded) continue;
    index.exact.add(folded);
    index.base.add(baseKey(value));
    const group = aliasGroupOf(value);
    if (group !== null) index.groups.add(group);
    const tokens = tokensOf(value);
    for (const t of tokens) index.tokens.add(t);
    index.items.push({ raw: value, tokens });
  }
  return index;
}

/**
 * Whether a candidate's term covers a seat's, and through which of their own
 * words. The direction matters: a candidate holding "AWS Certified Solutions
 * Architect Professional" satisfies a seat asking for "AWS Certified Solutions
 * Architect", and never the other way round.
 *
 * Containment is attempted only when the requirement has at least two
 * meaningful words, one of them three characters or more. That one guard
 * produces every direction rule on its own: "Java" and "JavaScript" are
 * different single words and are never related; a seat asking for "Azure" is
 * never satisfied by "Azure DevOps"; and a credential grade is safe in both
 * directions, since "CSCS" is one word and "CSCS Gold" is not contained in it.
 */
function contains(index: CandidateIndex, requiredTokens: string[]): string | null {
  if (requiredTokens.length < 2) return null;
  if (!requiredTokens.some((t) => t.length >= 3)) return null;
  // Cheap gate: if any required word appears nowhere, no item can contain them all.
  if (!requiredTokens.every((t) => index.tokens.has(t))) return null;

  const ceiling = requiredTokens.length + MAX_EXTRA_TOKENS;
  for (const item of index.items) {
    if (item.tokens.length <= requiredTokens.length) continue;
    if (item.tokens.length > ceiling) continue;
    const have = new Set(item.tokens);
    if (requiredTokens.every((t) => have.has(t))) return item.raw;
  }
  return null;
}

export interface QualityResult {
  quality: MatchQuality;
  /** 1 for the three full-credit layers, NEAR_MATCH_CREDIT for near, 0 for none. */
  credit: number;
  /** The candidate's own spelling that satisfied it, when one did. */
  via: string | null;
}

/** How one candidate term measures against one requirement. */
export function matchQuality(candidateItem: string, requiredItem: string): QualityResult {
  return qualityAgainst(buildCandidateIndex([candidateItem]), requiredItem);
}

/** How a whole candidate measures against one requirement. */
export function qualityAgainst(index: CandidateIndex, requiredItem: string): QualityResult {
  const folded = fold(requiredItem);
  if (!folded) return { quality: "none", credit: 0, via: null };

  if (index.exact.has(folded)) {
    return { quality: "exact", credit: 1, via: viaFold(index, folded) };
  }

  const group = aliasGroupOf(requiredItem);
  if (group !== null && index.groups.has(group)) {
    return { quality: "alias", credit: 1, via: viaGroup(index, group) };
  }

  const base = baseKey(requiredItem);
  if (index.base.has(base)) {
    return { quality: "version", credit: 1, via: viaBase(index, base) };
  }

  const covered = contains(index, tokensOf(requiredItem));
  if (covered) return { quality: "near", credit: NEAR_MATCH_CREDIT, via: covered };

  return { quality: "none", credit: 0, via: null };
}

function viaFold(index: CandidateIndex, folded: string): string | null {
  return index.items.find((i) => fold(i.raw) === folded)?.raw ?? null;
}
function viaGroup(index: CandidateIndex, group: number): string | null {
  return index.items.find((i) => aliasGroupOf(i.raw) === group)?.raw ?? null;
}
function viaBase(index: CandidateIndex, base: string): string | null {
  return index.items.find((i) => baseKey(i.raw) === base)?.raw ?? null;
}
