/**
 * Everything decidable about AI-assisted CV extraction, with no I/O.
 *
 * The fetch lives in ai-extractor.ts and is deliberately thin. What goes out,
 * what the model is asked, what its answer is allowed to look like, and how
 * that answer is folded into the local parser's result are all here, where
 * they can be tested without a key.
 *
 * Two facts shape this file. Groq's free tier allows 8,000 tokens a minute,
 * so the text is capped before it leaves. And the matching engine scores a
 * role by exact token overlap, so a model that answers "BA" for a Business
 * Analyst caps that candidate at 65 against a strong-match threshold of 70:
 * the prompt therefore carries the exact spellings the system uses.
 *
 * Pure, no I/O.
 */

import type { ExtractedCandidateFields } from "@/lib/extraction/types";
import type {
  WorkExperience,
  Education,
  CandidateAvailability,
  SkillCategory,
  Certificate,
  ProjectGroup,
} from "@/lib/supabase/database.types";
import {
  ALL_ROLES,
  ALL_TECHNICAL_SKILLS,
  ALL_SKILLS,
  ALL_CERTIFICATIONS,
  ALL_SECTORS,
  SEED_LANGUAGES,
} from "@/lib/vocabulary";

// -------------------------------------------------------------------------
// What leaves the building
// -------------------------------------------------------------------------

/**
 * Roughly 3,000 tokens of CV. The budget is 8,000 a minute, and the prompt
 * with its role list, the schema, the completion allowance and a little
 * reasoning spend close to 4,000 of those before a single word of the CV is
 * counted. The first twelve thousand characters carry the summary, the skills
 * and the recent roles, which is where the value is. The local parser still
 * reads every page. Tune from usage.prompt_tokens once real calls exist.
 */
export const AI_INPUT_CHAR_CAP = 12_000;

/** Cut at a line break rather than mid-word, so the model does not read a torn sentence. */
export function truncateForAi(text: string): { text: string; truncated: boolean } {
  if (text.length <= AI_INPUT_CHAR_CAP) return { text, truncated: false };
  const head = text.slice(0, AI_INPUT_CHAR_CAP);
  const cut = head.lastIndexOf("\n");
  return { text: cut > AI_INPUT_CHAR_CAP / 2 ? head.slice(0, cut) : head, truncated: true };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * South African phone numbers as CVs actually write them: +27 82 123 4567,
 * 082 123 4567, (012) 345 6789, 082-123-4567, 0821234567. The shape is a
 * country code or leading zero, then nine digits with any spacing, dots,
 * dashes or brackets in between. Anchored on non-digits so a 13-digit ID or a
 * Rand amount is never mistaken for one.
 */
const PHONE_RE =
  /(?<![\d])(?:\+27[\s.-]?|\(?0)\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\d])/g;

/** A South African ID number is exactly thirteen digits, written solid. */
const SA_ID_RE = /(?<![\d])\d{13}(?![\d])/g;

/** "Date of Birth: 12 March 1985" and "DOB 1985-03-12". The rest of the line goes. */
const DOB_RE = /\b(?:date of birth|d\.?o\.?b\.?)\b[^\n]{0,40}/gi;

/**
 * Remove what the model does not need and should not see.
 *
 * The local parser already reads email, phone and ID from the contact block,
 * deterministically. The model is asked about skills, history and
 * qualifications, none of which need any of these. Each is replaced with a
 * marker rather than deleted so the model reads a redaction, not a gap in the
 * sentence. Years, dates and amounts survive: the regexes are anchored on
 * non-digits and the phone shape is too specific to catch them.
 */
export function stripPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[email removed]")
    .replace(SA_ID_RE, "[id number removed]")
    .replace(PHONE_RE, "[phone removed]")
    .replace(DOB_RE, "[date of birth removed]");
}

// -------------------------------------------------------------------------
// The schema
// -------------------------------------------------------------------------

/**
 * What the model may answer, in Groq's strict mode.
 *
 * Mirrors ExtractedCandidateFields minus the five contact fields, which are
 * stripped from the input and come from the local parser instead. Strict mode
 * requires every property listed as required and additionalProperties false
 * on every object, with optional values expressed as a union with null;
 * isStrictSchema below checks that structurally so nobody can add a field
 * and forget the rule.
 */
const nullableString = { type: ["string", "null"] } as const;
const stringList = { type: "array", items: { type: "string" } } as const;

export const CV_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "current_role",
    "additional_roles",
    "years_experience",
    "professional_summary",
    "skills",
    "technical_skills",
    "certifications",
    "qualifications",
    "sectors",
    "languages",
    "designated_group",
    "availability",
    "work_experience",
    "education",
    "skill_matrix",
    "certificates",
    "projects",
    "achievements",
  ],
  properties: {
    current_role: nullableString,
    additional_roles: stringList,
    years_experience: { type: ["number", "null"] },
    professional_summary: nullableString,
    skills: stringList,
    technical_skills: stringList,
    certifications: stringList,
    qualifications: stringList,
    sectors: stringList,
    languages: stringList,
    designated_group: nullableString,
    availability: { type: ["string", "null"], enum: ["available", "notice_period", "unavailable", null] },
    work_experience: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "company",
          "client",
          "location",
          "employment_type",
          "start_date",
          "end_date",
          "is_current",
          "description",
          "achievements",
        ],
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          client: nullableString,
          location: nullableString,
          employment_type: nullableString,
          start_date: nullableString,
          end_date: nullableString,
          is_current: { type: "boolean" },
          description: nullableString,
          achievements: nullableString,
        },
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["qualification", "field", "institution", "year"],
        properties: {
          qualification: { type: "string" },
          field: nullableString,
          institution: nullableString,
          year: nullableString,
        },
      },
    },
    skill_matrix: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "skills"],
        properties: {
          category: { type: "string" },
          skills: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "years"],
              properties: { name: { type: "string" }, years: nullableString },
            },
          },
        },
      },
    },
    certificates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "institution", "year"],
        properties: { name: { type: "string" }, institution: nullableString, year: nullableString },
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["company", "projects"],
        properties: { company: { type: "string" }, projects: stringList },
      },
    },
    achievements: nullableString,
  },
} as const;

type SchemaNode = {
  type?: string | readonly string[];
  properties?: Record<string, SchemaNode>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: SchemaNode;
};

/**
 * Every way a schema fails Groq's strict mode, as a list of paths.
 *
 * Empty means valid. Tested against CV_SCHEMA, and tested to catch a field
 * deliberately left out of required, so the check itself is known to work.
 */
export function isStrictSchema(schema: unknown, path = "$"): string[] {
  const node = schema as SchemaNode;
  const problems: string[] = [];
  const isObject =
    node.type === "object" || (Array.isArray(node.type) && node.type.includes("object"));

  if (isObject) {
    if (node.additionalProperties !== false) {
      problems.push(`${path}: additionalProperties must be false`);
    }
    const props = Object.keys(node.properties ?? {});
    const required = new Set(node.required ?? []);
    for (const p of props) {
      if (!required.has(p)) problems.push(`${path}.${p}: not listed in required`);
    }
    for (const r of required) {
      if (!props.includes(r)) problems.push(`${path}.${r}: required but not defined`);
    }
    for (const [name, child] of Object.entries(node.properties ?? {})) {
      problems.push(...isStrictSchema(child, `${path}.${name}`));
    }
  }
  if (node.items) problems.push(...isStrictSchema(node.items, `${path}[]`));

  return problems;
}

// -------------------------------------------------------------------------
// The prompt
// -------------------------------------------------------------------------

/**
 * Short, and specific to the business.
 *
 * The role list is the expensive part, around four hundred tokens, and it is
 * the part that pays: a role spelled the way the system spells it scores
 * 35 points in matching, and one spelled any other way scores none.
 */
export function buildPrompt(cvText: string): string {
  return [
    "You are reading a CV for a South African staffing company that places people on public sector and private tenders.",
    "Extract the candidate's details as JSON matching the schema. Rules:",
    "- If something is not stated, return null or an empty list. Never guess and never invent.",
    "- current_role is their most recent or most senior job title. Spell roles exactly as they appear in this list where one fits, otherwise use the CV's own words:",
    ALL_ROLES.join(", "),
    "- skills are professional, domain and soft skills. technical_skills are tools, languages, frameworks and platforms. Do not put the same item in both.",
    "- qualifications are degrees and diplomas, the award name only: 'BTech Information Technology', not the institution or the year, which belong in education. certifications are professional certifications like PMP or AWS. Keep them apart.",
    "- years_experience is total professional years as a number, or null if it cannot be read off the CV.",
    "- designated_group is only for South African employment equity wording stated outright on the CV (for example African, Coloured, Indian, White, person with a disability). Otherwise null.",
    "- availability is only for an explicit statement: available, notice_period, or unavailable. Otherwise null.",
    "- work_experience: one entry per job, most recent first. Dates as written on the CV. is_current true only if the CV says so. client is the end client when the employer placed them somewhere else, otherwise null.",
    "- skill_matrix: skills grouped by category as the CV groups them, with years beside a skill only when the CV gives them. Leave empty if the CV has no such grouping.",
    "- certificates: each certificate or course with its institution and year where given. Every name here should also appear in certifications.",
    "- projects: named projects grouped by the company they were done for, only if the CV lists them that way.",
    "- achievements: the CV's achievements or memberships section as written, or null.",
    "- Contact details have been removed from the text and are not wanted.",
    "",
    "CV:",
    cvText,
  ].join("\n");
}

export const AI_MODEL = "openai/gpt-oss-120b";

/**
 * The whole request, minus the key.
 *
 * Built here rather than in the extractor so the bench script, which cannot
 * import a server-only module, sends exactly what the app sends. Two copies
 * of a prompt drift, and a benchmark that measures a different prompt from
 * the one in production measures nothing.
 */
export function buildRequestBody(rawText: string): {
  body: Record<string, unknown>;
  truncated: boolean;
} {
  const { text, truncated } = truncateForAi(stripPii(rawText));
  return {
    truncated,
    body: {
      model: AI_MODEL,
      // Fewer hidden reasoning tokens, and none of them echoed back. The task
      // is reading, not reasoning, and every token counts against an 8,000 a
      // minute budget. Both are GPT-OSS parameters on Groq.
      reasoning_effort: "low",
      include_reasoning: false,
      // Extraction wants the same answer twice for the same CV.
      temperature: 0,
      max_completion_tokens: 2000,
      messages: [{ role: "user", content: buildPrompt(text) }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "cv", strict: true, schema: CV_SCHEMA },
      },
    },
  };
}

// -------------------------------------------------------------------------
// Reading the answer
// -------------------------------------------------------------------------

const AVAILABILITY: CandidateAvailability[] = ["available", "notice_period", "unavailable"];

const fold = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The system's spelling wherever there is one, the model's otherwise.
 *
 * The first real run returned "ENGLISH" and "AFRIKAANS", faithfully copied
 * from a capitalised block on the CV, over a local result that had them in
 * ordinary case. Scoring folds case so nothing broke, but a screen full of
 * shouted languages is wrong, and the same thing would happen to "javascript"
 * or "power bi". Matching is on case and whitespace only: a value the
 * vocabulary does not know passes through as the model wrote it, because
 * the model knowing a skill the vocabulary does not is the point.
 */
export function canonicalise(values: string[], vocabulary: readonly string[]): string[] {
  const known = new Map(vocabulary.map((v) => [fold(v), v]));
  return values.map((v) => known.get(fold(v)) ?? v);
}

const asString = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const asStringList = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const s = asString(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
};

const asYears = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 60) return null;
  return Math.round(n * 2) / 2;
};

function asWorkExperience(v: unknown): WorkExperience[] {
  if (!Array.isArray(v)) return [];
  const out: WorkExperience[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const title = asString(r.title);
    const company = asString(r.company);
    // A job needs at least one of the two to be worth keeping.
    if (!title && !company) continue;
    out.push({
      title: title ?? "",
      company: company ?? "",
      client: asString(r.client),
      location: asString(r.location),
      employment_type: asString(r.employment_type),
      start_date: asString(r.start_date),
      end_date: asString(r.end_date),
      is_current: r.is_current === true,
      description: asString(r.description),
      achievements: asString(r.achievements),
    });
  }
  return out;
}

function asEducation(v: unknown): Education[] {
  if (!Array.isArray(v)) return [];
  const out: Education[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const qualification = asString(r.qualification);
    if (!qualification) continue;
    out.push({
      qualification,
      field: asString(r.field),
      institution: asString(r.institution),
      year: asString(r.year),
    });
  }
  return out;
}

function asSkillMatrix(v: unknown): SkillCategory[] {
  if (!Array.isArray(v)) return [];
  const out: SkillCategory[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const skills = Array.isArray(r.skills)
      ? r.skills
          .map((s) => {
            if (!s || typeof s !== "object") return null;
            const e = s as Record<string, unknown>;
            const name = asString(e.name);
            return name ? { name, years: asString(e.years) } : null;
          })
          .filter((s): s is { name: string; years: string | null } => s !== null)
      : [];
    if (skills.length === 0) continue;
    out.push({ category: asString(r.category) ?? "General", skills });
  }
  return out;
}

function asCertificates(v: unknown): Certificate[] {
  if (!Array.isArray(v)) return [];
  const out: Certificate[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = asString(r.name);
    if (!name) continue;
    out.push({ name, institution: asString(r.institution), year: asString(r.year) });
  }
  return out;
}

function asProjects(v: unknown): ProjectGroup[] {
  if (!Array.isArray(v)) return [];
  const out: ProjectGroup[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const company = asString(r.company);
    const projects = asStringList(r.projects);
    if (!company && projects.length === 0) continue;
    out.push({ company: company ?? "", projects });
  }
  return out;
}

/** The fields the model is allowed to fill. Everything else is the local parser's. */
export type AiFields = Omit<
  ExtractedCandidateFields,
  "full_name" | "email" | "phone" | "linkedin_url" | "portfolio_url" | "date_of_birth" | "cv_as_of"
>;

/**
 * Turn whatever came back into fields the app can use.
 *
 * Strict mode promises the shape, but the model, the network and JSON.parse
 * do not, and a review dialog that crashes on one odd answer is worse than
 * one that shows a blank field. Every value is checked and anything
 * unrecognisable becomes the empty value. This never throws.
 */
export function coerceAiFields(json: unknown): AiFields {
  const r = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const availability = asString(r.availability);
  const role = asString(r.current_role);
  return {
    current_role: role ? canonicalise([role], ALL_ROLES)[0] : null,
    additional_roles: canonicalise(asStringList(r.additional_roles), ALL_ROLES),
    years_experience: asYears(r.years_experience),
    professional_summary: asString(r.professional_summary),
    skills: canonicalise(asStringList(r.skills), ALL_SKILLS),
    technical_skills: canonicalise(asStringList(r.technical_skills), ALL_TECHNICAL_SKILLS),
    certifications: canonicalise(asStringList(r.certifications), ALL_CERTIFICATIONS),
    // No vocabulary for qualifications: a degree name is the CV's to spell.
    qualifications: asStringList(r.qualifications),
    sectors: canonicalise(asStringList(r.sectors), ALL_SECTORS),
    languages: canonicalise(asStringList(r.languages), SEED_LANGUAGES),
    designated_group: asString(r.designated_group),
    ...(availability && (AVAILABILITY as string[]).includes(availability)
      ? { availability: availability as CandidateAvailability }
      : {}),
    work_experience: asWorkExperience(r.work_experience),
    education: asEducation(r.education),
    skill_matrix: asSkillMatrix(r.skill_matrix),
    certificates: asCertificates(r.certificates),
    projects: asProjects(r.projects),
    achievements: asString(r.achievements),
  };
}

// -------------------------------------------------------------------------
// Folding it in
// -------------------------------------------------------------------------

const LIST_FIELDS = [
  "additional_roles",
  "skills",
  "technical_skills",
  "certifications",
  "qualifications",
  "sectors",
  "languages",
  "work_experience",
  "education",
  "skill_matrix",
  "certificates",
  "projects",
] as const;

/**
 * The local result with the model's answer laid over it.
 *
 * Identity and contact stay local: the model never saw them, and the regexes
 * that read a contact block are reliable in a way a model is not. The model
 * wins on everything semantic, with one exception: an empty list from the
 * model never wipes a non-empty one from the dictionary. A skill the local
 * parser caught and the model missed is still a skill.
 */
export function mergeExtraction(
  local: ExtractedCandidateFields,
  ai: AiFields,
): ExtractedCandidateFields {
  const merged: ExtractedCandidateFields = {
    ...local,
    current_role: ai.current_role ?? local.current_role,
    years_experience: ai.years_experience ?? local.years_experience,
    professional_summary: ai.professional_summary ?? local.professional_summary,
    designated_group: ai.designated_group ?? local.designated_group,
    achievements: ai.achievements ?? local.achievements ?? null,
    ...(ai.availability ? { availability: ai.availability } : {}),
  };

  for (const field of LIST_FIELDS) {
    const theirs = (ai[field] ?? []) as unknown[];
    if (theirs.length > 0) {
      (merged as unknown as Record<string, unknown>)[field] = theirs;
    }
  }

  return merged;
}
