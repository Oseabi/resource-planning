/**
 * What somebody asked the candidate finder for, as criteria.
 *
 * "Give me 3 software developers with MB-500" becomes
 * { count: 3, role: "Software Developer", certifications: ["MB-500"] }.
 * The search itself never sees the sentence, only this, so the same criteria
 * always give the same people, and the chat can show the reading back for
 * the person to correct.
 *
 * Read here by plain rules; the AI reading (ai.ts) produces the same shape and
 * goes through coerceTalentQuery, so a creative answer cannot widen a search.
 */
import { ALL_CERTIFICATIONS, ALL_ROLES, ALL_TECHNICAL_SKILLS } from "@/lib/vocabulary";
import { ALIAS_GROUPS } from "@/lib/skill-aliases";
import { fold } from "@/lib/skill-matching";
import { ARCHIVE_ROLES } from "@/lib/role-filter";
import { examCodesIn } from "@/lib/talent-search/certificates";

export interface TalentQuery {
  /** How many people to bring back. */
  count: number;
  role: string | null;
  skills: string[];
  certifications: string[];
  minYears: number | null;
  /** A town or province, matched against the candidate's location. */
  location: string | null;
  /** Only people available now. */
  availableNow: boolean;
}

export const DEFAULT_COUNT = 5;
export const MAX_COUNT = 25;

export const EMPTY_QUERY: TalentQuery = {
  count: DEFAULT_COUNT,
  role: null,
  skills: [],
  certifications: [],
  minYears: null,
  location: null,
  availableNow: false,
};

/** Whether a reading has anything to search on beyond a number. */
export function hasCriteria(q: TalentQuery): boolean {
  return Boolean(q.role || q.skills.length || q.certifications.length || q.minYears || q.location);
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, couple: 2, few: 3,
};

export const PLACES = [
  "Johannesburg", "Pretoria", "Cape Town", "Durban", "Centurion", "Midrand", "Sandton", "Randburg",
  "Roodepoort", "Soweto", "Polokwane", "Mbombela", "Nelspruit", "Bloemfontein", "Gqeberha",
  "Port Elizabeth", "East London", "Pietermaritzburg", "Kimberley", "Rustenburg", "Mahikeng",
  "Stellenbosch", "Gauteng", "Western Cape", "Eastern Cape", "KwaZulu-Natal", "KZN", "Limpopo",
  "Mpumalanga", "North West", "Free State", "Northern Cape", "Remote",
];

/** Known spellings of a thing, longest first, so "Senior Business Analyst" beats "Business Analyst". */
function lexicon(canonicals: string[], kind: "role" | "certification" | "technology"): { form: string; canonical: string }[] {
  const out: { form: string; canonical: string }[] = canonicals.map((c) => ({ form: fold(c), canonical: c }));
  for (const g of ALIAS_GROUPS) {
    if (g.kind !== kind) continue;
    for (const a of [g.canonical, ...g.aliases]) out.push({ form: fold(a), canonical: g.canonical });
  }
  return out
    .filter((e) => e.form.length >= 2)
    .sort((a, b) => b.form.length - a.form.length);
}

const ROLE_LEXICON = lexicon([...ALL_ROLES, ...ARCHIVE_ROLES], "role");
const ROLE_MULTI = ROLE_LEXICON.filter((e) => e.form.includes(" "));
const ROLE_SINGLE = ROLE_LEXICON.filter((e) => !e.form.includes(" "));
/** Certificates recruiters ask for by name that the vocabulary does not carry. */
const MORE_CERTIFICATES = [
  "ISTQB", "ISTQB Foundation", "ISTQB Advanced", "CBAP", "CCBA", "ECBA", "IIBA", "CCNA", "CCNP", "CCIE",
  "PSM", "PSPO", "Lean Six Sigma", "Six Sigma", "OCP", "OCA", "RHCSA", "RHCE", "CKA", "CKAD",
  "CompTIA A+", "CompTIA Network+", "Security+", "CRISC", "CGEIT", "ACCA", "CIMA", "CFA",
  "CA(SA)", "SAICA", "RE5", "RE1", "FAIS", "TOGAF", "ArchiMate", "SAFe Agilist", "Salesforce Administrator",
];
const CERT_LEXICON = lexicon([...ALL_CERTIFICATIONS, ...MORE_CERTIFICATES], "certification");
// One- and two-letter skills ("Go", "R", "C") are ordinary words in a sentence
// ("who can go to Durban"), so only the ones carrying + # or . are kept short.
const SKILL_LEXICON = lexicon(ALL_TECHNICAL_SKILLS, "technology").filter((e) => e.form.length >= 3 || /[+#.]/.test(e.form));

/**
 * Find lexicon entries in folded text as whole words (a trailing "s" allowed,
 * for plurals), take them out of the text so a word is used once, and return
 * what was found.
 */
function take(text: { value: string }, lex: { form: string; canonical: string }[], plural = false, max = 10): string[] {
  const found: string[] = [];
  for (const { form, canonical } of lex) {
    if (found.length >= max) break;
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^| )${escaped}${plural ? "(?:s|es)?" : ""}(?= |$)`);
    if (re.test(text.value)) {
      if (!found.includes(canonical)) found.push(canonical);
      text.value = text.value.replace(re, "$1 ").replace(/\s+/g, " ");
    }
  }
  return found;
}

function titleCase(s: string): string {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, "and");
}

/** "developers" to "developer", for a role nobody has a name for in the lexicon. */
function singular(word: string): string {
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ss|us)$/.test(word)) return word;
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Read a request by rules. Order matters: exam codes and years come out first,
 * so "MB 500" and "5 years" are never taken as how many people to find.
 */
export function parseTalentRequest(message: string): TalentQuery {
  const q: TalentQuery = { ...EMPTY_QUERY, skills: [], certifications: [] };
  let raw = message;

  q.certifications.push(...examCodesIn(raw));
  raw = raw.replace(/\b(MB|PL|AZ|DP|SC|MS|AI|MD|DA)\s*[-‐-―]?\s*\d{3}\b/gi, " ");

  const years = raw.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i);
  if (years) {
    q.minYears = Number(years[1]);
    raw = raw.replace(years[0], " ");
  }

  for (const place of PLACES) {
    const re = new RegExp(`\\b${place.replace(/[-]/g, "[- ]?")}\\b`, "i");
    if (re.test(raw)) {
      q.location = place === "KZN" ? "KwaZulu-Natal" : place === "Port Elizabeth" ? "Gqeberha" : place;
      raw = raw.replace(re, " ");
      break;
    }
  }

  if (/\b(available\s+(now|immediately|asap|today)|immediately\s+available|can\s+start\s+(now|immediately))\b/i.test(raw)) {
    q.availableNow = true;
  }

  const text = { value: fold(raw) };

  const n = text.value.match(/(?:^| )(\d{1,3})(?= |$)/);
  if (n) {
    q.count = Number(n[1]);
    text.value = text.value.replace(n[0], " ");
  } else {
    const word = text.value.match(/(?:^| )(a couple of|a few|couple|few|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)(?= |$)/);
    if (word) q.count = NUMBER_WORDS[word[1].replace(/^a (couple|few) of$/, "$1").replace(/^a /, "")] ?? DEFAULT_COUNT;
  }
  q.count = Math.min(MAX_COUNT, Math.max(1, q.count));

  for (const c of take(text, CERT_LEXICON)) if (!q.certifications.includes(c)) q.certifications.push(c);
  // Anything else said to be a certificate: "with a Fortinet NSE 4 certificate".
  const said = text.value.match(/(?:with|having|holding|has|have)(?: an?| the)? ((?:[a-z0-9+#.]+ ){1,4}?)(?:certificate|certification|cert|certified)s?(?= |$)/);
  if (said) {
    const name = said[1].trim();
    if (name && !/^(a|an|the|any|some)$/.test(name)) q.certifications.push(name.toUpperCase() === name ? name : name.replace(/([a-z])/g, (m) => m.toUpperCase()));
    text.value = text.value.replace(said[0], " ");
  }
  text.value = text.value.replace(/(?:^| )(?:certificates?|certifications?|certs?|certified)(?= |$)/g, " ");
  // A full role name first; then the role as written ("dynamics developer"),
  // which is more specific than a one-word alias such as "developer"; then
  // that alias as a last resort.
  q.role = take(text, ROLE_MULTI, true, 1)[0] ?? null;
  q.skills = take(text, SKILL_LEXICON, false, 8);

  let loneWord: string | null = null;
  if (!q.role) {
    // No known role: take the words before "with/who/that/in/having" as the
    // role, as written, so "3 dynamics developers with ..." still reads.
    const m = text.value.match(/(?:^| )(?:give me|find me|find|get me|get|show me|show|i need|need|looking for|search for)?\s*((?:[a-z0-9+#.]+ ){0,3}(?:developers?|engineers?|analysts?|consultants?|managers?|architects?|administrators?|testers?|specialists?|leads?|officers?|designers?|scientists?|accountants?|advisors?|owners?|masters?))(?= |$)/);
    if (m) {
      const words = m[1].trim().split(" ").filter((w) => !["me", "some", "the", "of", "senior", "good", "strong"].includes(w));
      if (words.length > 0) {
        words[words.length - 1] = singular(words[words.length - 1]);
        if (words.length > 1) q.role = titleCase(words.join(" "));
        else loneWord = titleCase(words[0]);
      }
    }
  }
  if (!q.role) q.role = take(text, ROLE_SINGLE, true, 1)[0] ?? loneWord;
  return q;
}

/**
 * A follow-up in the same conversation refines the last search ("make it 5",
 * "only in Cape Town", "who also have PMP"); a message naming a role starts a
 * new one.
 */
export function refineQuery(previous: TalentQuery | null, message: string, next: TalentQuery): TalentQuery {
  if (!previous || next.role) return next;
  const saidCount = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b/i.test(message.replace(/\b(MB|PL|AZ|DP|SC|MS|AI|MD|DA)\s*[-]?\s*\d{3}\b/gi, "").replace(/\d+\s*\+?\s*(years?|yrs?)/gi, ""));
  const dropCerts = /\b(without|no need for|drop|remove|any) (the )?(cert|certificate|certification)s?\b/i.test(message);
  return {
    count: saidCount ? next.count : previous.count,
    role: previous.role,
    skills: [...new Set([...previous.skills, ...next.skills])],
    certifications: dropCerts ? [] : [...new Set([...previous.certifications, ...next.certifications])],
    minYears: next.minYears ?? previous.minYears,
    location: /\b(anywhere|any location|any city)\b/i.test(message) ? null : (next.location ?? previous.location),
    availableNow: next.availableNow || previous.availableNow,
  };
}

function strings(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter((s) => s && s.length <= 120))].slice(0, max);
}

/** Any object, made into a safe query. Never throws. */
export function coerceTalentQuery(value: unknown): TalentQuery {
  const v = (value ?? {}) as Record<string, unknown>;
  const count = typeof v.count === "number" && Number.isFinite(v.count) ? Math.round(v.count) : DEFAULT_COUNT;
  const role = typeof v.role === "string" && v.role.trim() && v.role.length <= 80 ? v.role.trim() : null;
  const minYears = typeof v.minYears === "number" && v.minYears > 0 && v.minYears < 60 ? Math.round(v.minYears) : null;
  const location = typeof v.location === "string" && v.location.trim() && v.location.length <= 60 ? v.location.trim() : null;
  // Exam codes said any way come out as "MB-500".
  // "MB-500 certificate" and "Microsoft MB500" are the exam, said precisely.
  const certifications = strings(v.certifications, 8).map((c) => {
    const codes = examCodesIn(c);
    return codes.length === 1 ? codes[0] : c;
  });
  return {
    count: Math.min(MAX_COUNT, Math.max(1, count)),
    role,
    skills: strings(v.skills, 8),
    certifications: [...new Set(certifications)],
    minYears,
    location,
    availableNow: v.availableNow === true,
  };
}

/** The reading, said back in a line: "3 × Software Developer · MB-500 · 5+ years". */
export function describeQuery(q: TalentQuery): string {
  const parts = [`${q.count} × ${q.role ?? "any role"}`];
  if (q.certifications.length) parts.push(q.certifications.join(", "));
  if (q.skills.length) parts.push(q.skills.join(", "));
  if (q.minYears) parts.push(`${q.minYears}+ years`);
  if (q.location) parts.push(q.location);
  if (q.availableNow) parts.push("available now");
  return parts.join(" · ");
}
