/**
 * Reading a candidate roster into the shape the app stores.
 *
 * Migration tooling, and deliberately the lesser of the two ways a person gets
 * into this system. A CV on the TiPP Focus template parses into a full work
 * history and education record; a spreadsheet row cannot hold either. So this
 * importer exists for two jobs a CV cannot do:
 *
 *   1. people who have no CV on file yet, and
 *   2. the five columns no CV carries: availability, available_from, status,
 *      resource_categories and notes.
 *
 * That second job is the one that pays for it. Setting availability and
 * practice areas across a loaded pool is otherwise fifty trips through a form.
 *
 * The rule that keeps it honest: once a candidate has a CV on file, a column
 * the CV filled in is never overwritten from here, only filled in when it is
 * empty. A thin row typed in a hurry cannot flatten a parsed record.
 *
 * Everything decidable lives in this file and is unit-tested. The script in
 * scripts/ is only the I/O shell around it.
 *
 * Pure, no I/O.
 */

import type { CsvTable } from "@/lib/csv";
import { parseImportDate, parseList, resolveRole, type RoleIndex } from "@/lib/tender-import";
import { deriveCategories, CATEGORY_NAMES } from "@/lib/resource-categories";
import type { CandidateAvailability, CandidateStatus } from "@/lib/supabase/database.types";

/**
 * Columns the CV fills in. On a candidate who already has a CV on file these
 * are filled when empty and never replaced, because the parsed record is the
 * better one and a spreadsheet is not allowed to thin it out.
 */
export const CV_COLUMNS = [
  "full_name",
  "email",
  "phone",
  "location",
  "current_role",
  "additional_roles",
  "years_experience",
  "designated_group",
  "qualifications",
  "certifications",
  "technical_skills",
  "skills",
  "sectors",
  "languages",
] as const;

/**
 * Columns no CV carries. These are the reason this importer exists and they
 * always apply, CV or not.
 */
export const MANUAL_COLUMNS = [
  "availability",
  "available_from",
  "status",
  "resource_categories",
  "notes",
] as const;

export const CANDIDATE_COLUMNS = [...CV_COLUMNS, ...MANUAL_COLUMNS] as const;

const REQUIRED_COLUMNS = ["full_name"] as const;
const LIST_COLUMNS = [
  "additional_roles",
  "qualifications",
  "certifications",
  "technical_skills",
  "skills",
  "sectors",
  "languages",
  "resource_categories",
] as const;

const AVAILABILITIES: CandidateAvailability[] = ["available", "notice_period", "unavailable"];

/**
 * The eight employment equity groups, as they read on a submitted CV. Matched
 * case-insensitively so "african female" is corrected rather than stored as a
 * ninth group nobody can filter on.
 */
export const DESIGNATED_GROUPS = [
  "African Male",
  "African Female",
  "Coloured Male",
  "Coloured Female",
  "Indian Male",
  "Indian Female",
  "White Male",
  "White Female",
];

/**
 * The address in docs/candidate-roster-template.xlsx's example row.
 *
 * Forgetting to delete the example is the likeliest mistake anybody makes with
 * a filled-in template, and it is an exact string rather than a guess, so it is
 * worth saying plainly instead of quietly creating a person who does not exist.
 */
const TEMPLATE_EXAMPLE_EMAIL = "t.mokoena@example.co.za";

export interface ParsedCandidate {
  line: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  current_role: string | null;
  additional_roles: string[];
  years_experience: number | null;
  designated_group: string | null;
  qualifications: string[];
  certifications: string[];
  technical_skills: string[];
  skills: string[];
  sectors: string[];
  languages: string[];
  /** Null when blank, so the column default applies rather than a guess. */
  availability: CandidateAvailability | null;
  available_from: string | null;
  status: CandidateStatus | null;
  resource_categories: string[];
  notes: string | null;
  /** Role spellings corrected, always printed. */
  roleNotes: string[];
  warnings: string[];
}

export interface RowProblem {
  line: number;
  name: string;
  reasons: string[];
}

// -------------------------------------------------------------------------
// Cell readers
// -------------------------------------------------------------------------

/**
 * Whole or part years, and zero is a real answer: a graduate has none. That is
 * why this cannot go through the tender importer's parseCount, which treats
 * zero as a mistake because a seat asking for zero people is one.
 */
export function parseYears(raw: string): { years: number | null; error: string | null } {
  const v = raw.trim();
  if (!v) return { years: null, error: null };
  if (!/^\d+(\.\d+)?$/.test(v)) return { years: null, error: `"${v}" is not a number of years` };
  const n = Number(v);
  if (n > 60) return { years: null, error: `"${v}" years is longer than a career` };
  return { years: n, error: null };
}

export function parseAvailability(raw: string): {
  availability: CandidateAvailability | null;
  error: string | null;
} {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!v) return { availability: null, error: null };
  if ((AVAILABILITIES as string[]).includes(v)) {
    return { availability: v as CandidateAvailability, error: null };
  }
  return { availability: null, error: `"${raw.trim()}" is not one of ${AVAILABILITIES.join(", ")}` };
}

/**
 * Only "active" and "inactive" can be set from a spreadsheet.
 *
 * "placed" is written by the placement trigger and means somebody is sitting on
 * a contract. Typing it here would produce a candidate the system reports as
 * placed with nothing to show for it, which is one of the rows
 * supabase/orphan_check.sql exists to catch.
 */
export function parseCandidateStatus(raw: string): {
  status: CandidateStatus | null;
  error: string | null;
} {
  const v = raw.trim().toLowerCase();
  if (!v) return { status: null, error: null };
  if (v === "active" || v === "inactive") return { status: v, error: null };
  if (v === "placed") {
    return {
      status: null,
      error: "placed is set by the system when somebody is assigned to a contract, not from a sheet",
    };
  }
  return { status: null, error: `"${raw.trim()}" is not one of active, inactive` };
}

/** Corrected to the canonical spelling, since case drift makes a group unfilterable. */
export function parseDesignatedGroup(raw: string): {
  group: string | null;
  note: string | null;
  warning: string | null;
} {
  const v = raw.trim();
  if (!v) return { group: null, note: null, warning: null };
  const found = DESIGNATED_GROUPS.find((g) => g.toLowerCase() === v.toLowerCase());
  if (!found) {
    // Free text rather than a rejection, because the app's own field allows it.
    // Said out loud, because it is scored on most public sector bids and a
    // spelling nothing recognises quietly scores nothing.
    return {
      group: v,
      note: null,
      warning: `designated group "${v}" is not one of the eight, so it will not be counted on a bid`,
    };
  }
  return { group: found, note: found === v ? null : `"${v}" read as "${found}"`, warning: null };
}

/** Digits only, last nine, so +27 82 555 0143 and 082 555 0143 are one person. */
export function phoneKey(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : digits || null;
}

const emailKey = (raw: string | null) => (raw ? raw.trim().toLowerCase() : null);
const nameKey = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, " ");

// -------------------------------------------------------------------------
// Rows
// -------------------------------------------------------------------------

/**
 * Roles are resolved against the same index the tender importer uses, because
 * this is the same cliff seen from the other side: matching scores a seat's
 * role against a candidate's, and a candidate stored as "Snr BA" shares no
 * token with a "Business Analyst" seat. Role is 35 of 100 points and a strong
 * match needs 70, so that person can never be a strong match for their own
 * discipline, and nothing on screen says why.
 */
function resolveCandidateRole(
  input: string,
  index: RoleIndex,
): { role: string | null; note: string | null; error: string | null } {
  // The shared resolver, not a second copy, so the two importers cannot drift
  // into two notions of what a known role is.
  const { role, via, suggestions } = resolveRole(input, index);
  if (!role) {
    return {
      role: null,
      note: null,
      error:
        suggestions.length > 0
          ? `"${input.trim()}" is not a known role. Closest: ${suggestions.join(", ")}`
          : `"${input.trim()}" is not a known role`,
    };
  }
  return { role, note: via === "alias" ? `"${input.trim()}" read as "${role}"` : null, error: null };
}

export function readCandidateRows(
  table: CsvTable,
  index: RoleIndex,
): { parsed: ParsedCandidate[]; problems: RowProblem[]; unknownRoles: string[] } {
  const problems: RowProblem[] = [];
  const unknownRoles = new Set<string>();

  const known = new Set<string>(CANDIDATE_COLUMNS);
  const unknown = table.headers.filter((h) => h && !known.has(h));
  const missing = REQUIRED_COLUMNS.filter((c) => !table.headers.includes(c));
  if (unknown.length > 0 || missing.length > 0) {
    const reasons: string[] = [];
    if (missing.length > 0) {
      reasons.push(`missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
    }
    if (unknown.length > 0) {
      reasons.push(
        `unrecognised column${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
      );
    }
    return { parsed: [], problems: [{ line: 1, name: "header row", reasons }], unknownRoles: [] };
  }

  for (const p of table.problems) {
    problems.push({ line: p.line, name: "unreadable row", reasons: [p.message] });
  }

  const parsed: ParsedCandidate[] = [];

  for (const row of table.rows) {
    const cell = (name: string) => row.cells[name] ?? "";
    const reasons: string[] = [];
    const warnings: string[] = [];
    const roleNotes: string[] = [];

    const fullName = cell("full_name").trim();
    if (!fullName) reasons.push("no name");

    let currentRole: string | null = null;
    if (cell("current_role").trim()) {
      const r = resolveCandidateRole(cell("current_role"), index);
      if (r.error) {
        reasons.push(`current_role: ${r.error}`);
        unknownRoles.add(cell("current_role").trim());
      } else {
        currentRole = r.role;
        if (r.note) roleNotes.push(r.note);
      }
    }

    const additionalRoles: string[] = [];
    for (const raw of parseList(cell("additional_roles"))) {
      const r = resolveCandidateRole(raw, index);
      if (r.error) {
        reasons.push(`additional_roles: ${r.error}`);
        unknownRoles.add(raw.trim());
        continue;
      }
      if (r.role) additionalRoles.push(r.role);
      if (r.note) roleNotes.push(r.note);
    }

    const years = parseYears(cell("years_experience"));
    if (years.error) reasons.push(`years_experience: ${years.error}`);

    const availability = parseAvailability(cell("availability"));
    if (availability.error) reasons.push(`availability: ${availability.error}`);

    const status = parseCandidateStatus(cell("status"));
    if (status.error) reasons.push(`status: ${status.error}`);

    const availableFrom = parseImportDate(cell("available_from"));
    if (availableFrom.error) reasons.push(`available_from: ${availableFrom.error}`);

    const group = parseDesignatedGroup(cell("designated_group"));
    if (group.note) roleNotes.push(group.note);
    if (group.warning) warnings.push(group.warning);

    const email = cell("email").trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      reasons.push(`"${email}" is not an email address`);
    }
    if (email && email.toLowerCase() === TEMPLATE_EXAMPLE_EMAIL) {
      reasons.push("this is the example row from the template, delete it before sending the file");
    }

    const phone = cell("phone").trim() || null;
    if (!email && !phone) {
      // Not fatal, but it means this row can only ever be recognised by name,
      // and two people share a name more often than a spreadsheet expects.
      warnings.push("no email and no phone, so this person can only be matched by name");
    }

    const categories = parseList(cell("resource_categories"));
    const unknownCategories = categories.filter(
      (c) => !CATEGORY_NAMES.some((k) => k.toLowerCase() === c.toLowerCase()),
    );
    if (unknownCategories.length > 0) {
      warnings.push(`resource categories not in the taxonomy: ${unknownCategories.join(", ")}`);
    }

    if (availability.availability === "notice_period" && !availableFrom.date) {
      warnings.push("on notice with no available_from, so they read as free today");
    }

    if (reasons.length > 0) {
      problems.push({ line: row.line, name: fullName || "(no name)", reasons });
      continue;
    }

    const skills = parseList(cell("skills"));
    const technicalSkills = parseList(cell("technical_skills"));

    // Suggested, never applied. deriveCategories is what the form uses to
    // prompt a person, and a person accepting it is the point. But a blank
    // category is invisible to the pool filter and the dashboard, so it is
    // worth saying out loud that this row could have one.
    if (categories.length === 0) {
      const derived = deriveCategories({
        skills,
        technical_skills: technicalSkills,
        current_role: currentRole,
        additional_roles: additionalRoles,
      });
      if (derived.length > 0) {
        warnings.push(`no resource categories; their skills suggest ${derived.join(", ")}`);
      }
    }

    parsed.push({
      line: row.line,
      full_name: fullName,
      email,
      phone,
      location: cell("location").trim() || null,
      current_role: currentRole,
      additional_roles: additionalRoles,
      years_experience: years.years,
      designated_group: group.group,
      qualifications: parseList(cell("qualifications")),
      certifications: parseList(cell("certifications")),
      technical_skills: technicalSkills,
      skills,
      sectors: parseList(cell("sectors")),
      languages: parseList(cell("languages")),
      availability: availability.availability,
      available_from: availableFrom.date,
      status: status.status,
      resource_categories: categories,
      notes: cell("notes").trim() || null,
      roleNotes,
      warnings,
    });
  }

  return { parsed, problems, unknownRoles: [...unknownRoles].sort() };
}

// -------------------------------------------------------------------------
// The plan
// -------------------------------------------------------------------------

export interface ExistingCandidate {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  /** A parsed CV is the better record, so its columns are protected. */
  hasCv: boolean;
  columns: Record<string, unknown>;
}

export interface ColumnChange {
  column: string;
  from: unknown;
  to: unknown;
}

export type CandidateRowPlan =
  | { kind: "create"; row: ParsedCandidate }
  | {
      kind: "update";
      row: ParsedCandidate;
      targetId: string;
      targetName: string;
      matchedOn: "email" | "phone" | "name";
      hasCv: boolean;
      changes: ColumnChange[];
      /** Blank in the sheet, so left as it is. */
      leftAlone: string[];
      /** Already filled in from a CV, so not replaced. */
      declined: ColumnChange[];
    }
  | { kind: "unchanged"; row: ParsedCandidate; targetId: string }
  | { kind: "reject"; line: number; name: string; reasons: string[] };

export interface CandidatePlan {
  plans: CandidateRowPlan[];
  summary: { create: number; update: number; unchanged: number; reject: number };
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

const isList = (column: string) => (LIST_COLUMNS as readonly string[]).includes(column);

/**
 * Whether a stored value and a roster value are the same thing.
 *
 * Email and phone are compared the way they are matched, so
 * "T.Mokoena@Example.co.za" and "+27 82 555 0143" are recognised as what is
 * already on file rather than written over it. Without this, the first import
 * rewrites the casing of every address and the format of every number in the
 * pool, and buries the real changes in the report.
 */
function sameValue(column: string, from: unknown, to: unknown): boolean {
  if (isList(column)) return sameList(from as string[], to as string[]);
  if (column === "email") return emailKey(from as string | null) === emailKey(to as string | null);
  if (column === "phone") return phoneKey(from as string | null) === phoneKey(to as string | null);
  return from === to;
}

export function buildCandidatePlan(
  parsed: ParsedCandidate[],
  existing: ExistingCandidate[],
): CandidatePlan {
  const plans: CandidateRowPlan[] = [];

  const byEmail = new Map<string, ExistingCandidate[]>();
  const byPhone = new Map<string, ExistingCandidate[]>();
  const byName = new Map<string, ExistingCandidate[]>();
  const push = (map: Map<string, ExistingCandidate[]>, key: string | null, c: ExistingCandidate) => {
    if (!key) return;
    map.set(key, [...(map.get(key) ?? []), c]);
  };
  for (const c of existing) {
    push(byEmail, emailKey(c.email), c);
    push(byPhone, phoneKey(c.phone), c);
    push(byName, nameKey(c.full_name), c);
  }

  // The same person twice in one file cannot be resolved to one record, and
  // creating both is the duplicate this whole scheme exists to avoid.
  const emailCounts = new Map<string, number>();
  const phoneCounts = new Map<string, number>();
  for (const row of parsed) {
    const e = emailKey(row.email);
    if (e) emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1);
    const p = phoneKey(row.phone);
    if (p) phoneCounts.set(p, (phoneCounts.get(p) ?? 0) + 1);
  }

  for (const row of parsed) {
    const e = emailKey(row.email);
    const p = phoneKey(row.phone);

    if (e && (emailCounts.get(e) ?? 0) > 1) {
      plans.push({
        kind: "reject",
        line: row.line,
        name: row.full_name,
        reasons: [`${row.email} appears more than once in this file`],
      });
      continue;
    }
    if (p && (phoneCounts.get(p) ?? 0) > 1) {
      plans.push({
        kind: "reject",
        line: row.line,
        name: row.full_name,
        reasons: [`${row.phone} appears more than once in this file`],
      });
      continue;
    }

    // Email and phone identify a person. A name only gets to when there is
    // nothing else, because two people share one more often than a spreadsheet
    // expects, and merging them is not something a script should decide.
    let matches: ExistingCandidate[] = [];
    let matchedOn: "email" | "phone" | "name" = "email";
    if (e && byEmail.has(e)) {
      matches = byEmail.get(e) ?? [];
      matchedOn = "email";
    } else if (p && byPhone.has(p)) {
      matches = byPhone.get(p) ?? [];
      matchedOn = "phone";
    } else if (!e && !p) {
      matches = byName.get(nameKey(row.full_name)) ?? [];
      matchedOn = "name";
    }

    if (matches.length > 1) {
      plans.push({
        kind: "reject",
        line: row.line,
        name: row.full_name,
        reasons: [
          `${matchedOn} already matches ${matches.length} candidates, so this row cannot be resolved to one of them`,
        ],
      });
      continue;
    }

    if (matches.length === 0) {
      // A name that already exists under a different address is worth saying,
      // since it is either a second person or a duplicate about to be created.
      const sameName = byName.get(nameKey(row.full_name)) ?? [];
      if (sameName.length > 0 && !row.warnings.some((w) => w.startsWith("someone called"))) {
        row.warnings.push(
          `someone called ${row.full_name} is already on file under different contact details`,
        );
      }
      plans.push({ kind: "create", row });
      continue;
    }

    const target = matches[0];
    const changes: ColumnChange[] = [];
    const leftAlone: string[] = [];
    const declined: ColumnChange[] = [];

    for (const column of CANDIDATE_COLUMNS) {
      const to = (row as unknown as Record<string, unknown>)[column];
      const from = target.columns[column] ?? (isList(column) ? [] : null);

      // A blank cell means "not in the roster", never "clear this". Without
      // this a re-run silently erases every correction made in the app.
      if (isEmpty(to)) {
        if (!isEmpty(from)) leftAlone.push(column);
        continue;
      }

      if (sameValue(column, from, to)) continue;

      // The CV is the better record. Its columns are filled when empty and
      // never replaced, so a row typed in a hurry cannot flatten a parsed one.
      if (
        target.hasCv &&
        (CV_COLUMNS as readonly string[]).includes(column) &&
        !isEmpty(from)
      ) {
        declined.push({ column, from, to });
        continue;
      }

      changes.push({ column, from, to });
    }

    if (changes.length === 0) {
      plans.push({ kind: "unchanged", row, targetId: target.id });
      continue;
    }

    plans.push({
      kind: "update",
      row,
      targetId: target.id,
      targetName: target.full_name,
      matchedOn,
      hasCv: target.hasCv,
      changes,
      leftAlone,
      declined,
    });
  }

  return {
    plans,
    summary: {
      create: plans.filter((p) => p.kind === "create").length,
      update: plans.filter((p) => p.kind === "update").length,
      unchanged: plans.filter((p) => p.kind === "unchanged").length,
      reject: plans.filter((p) => p.kind === "reject").length,
    },
  };
}

// -------------------------------------------------------------------------
// The report
// -------------------------------------------------------------------------

export interface ReportMeta {
  file: string;
  delimiter: string;
  headers: string[];
  rowCount: number;
  operator: string;
  apply: boolean;
  unknownRoles?: string[];
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "blank";
  if (Array.isArray(v)) return v.length === 0 ? "blank" : v.join(" | ");
  return String(v);
};

/**
 * The report is the review step, so it says what would happen and why. The
 * declined lines matter most: they are where the spreadsheet and a parsed CV
 * disagree, and the CV wins without anybody being asked.
 */
export function formatCandidatePlan(plan: CandidatePlan, meta: ReportMeta): string {
  const out: string[] = [];
  const pad = (label: string) => label.padEnd(11);

  out.push(`${pad("file")}${meta.file}`);
  out.push(`${pad("delimiter")}${meta.delimiter}`);
  out.push(`${pad("headers")}${meta.headers.join(", ")}`);
  out.push(`${pad("rows")}${meta.rowCount} data row${meta.rowCount === 1 ? "" : "s"}`);
  out.push(`${pad("operator")}${meta.operator}`);
  out.push(
    `${pad("mode")}${meta.apply ? "APPLY, changes will be written" : "DRY RUN, nothing will be written"}`,
  );
  out.push("");

  for (const p of plan.plans) {
    if (p.kind === "reject") {
      out.push(`row ${p.line}  REJECT  "${p.name}"`);
      for (const reason of p.reasons) out.push(`        ${reason}`);
      out.push("");
      continue;
    }

    if (p.kind === "unchanged") {
      out.push(`row ${p.row.line}  UNCHANGED  "${p.row.full_name}"`);
      out.push("");
      continue;
    }

    if (p.kind === "create") {
      out.push(`row ${p.row.line}  CREATE  "${p.row.full_name}"`);
      if (p.row.current_role) {
        const years = p.row.years_experience;
        out.push(`        role       ${p.row.current_role}${years != null ? `, ${years} years` : ""}`);
      }
      if (p.row.email) out.push(`        email      ${p.row.email}`);
      const counts = [
        [p.row.skills.length + p.row.technical_skills.length, "skill"],
        [p.row.qualifications.length, "qualification"],
        [p.row.certifications.length, "certification"],
      ] as const;
      const filled = counts
        .filter(([n]) => n > 0)
        .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`);
      if (filled.length > 0) out.push(`        holds      ${filled.join(", ")}`);
      out.push("        no work history or education, which only a CV carries");
      for (const note of p.row.roleNotes) out.push(`        note       ${note}`);
      for (const w of p.row.warnings) out.push(`        warn       ${w}`);
      out.push("");
      continue;
    }

    const via = p.matchedOn === "name" ? "  matched on name alone" : "";
    out.push(`row ${p.row.line}  UPDATE  "${p.targetName}"${via}  -> candidate ${p.targetId}`);
    for (const c of p.changes) {
      out.push(`        ${c.column.padEnd(20)} ${show(c.from)} -> ${show(c.to)}`);
    }
    for (const column of p.leftAlone) {
      out.push(`        ${column.padEnd(20)} left alone, blank in the roster`);
    }
    for (const c of p.declined) {
      out.push(`        ${c.column.padEnd(20)} kept from the CV: ${show(c.from)}`);
      out.push(`        ${"".padEnd(20)}   the roster says ${show(c.to)}, edit it in the app if the CV is wrong`);
    }
    for (const note of p.row.roleNotes) out.push(`        note                 ${note}`);
    for (const w of p.row.warnings) out.push(`        warn                 ${w}`);
    out.push("");
  }

  if (meta.unknownRoles && meta.unknownRoles.length > 0) {
    out.push(
      `${meta.unknownRoles.length} role spelling${meta.unknownRoles.length === 1 ? "" : "s"} in this roster ${meta.unknownRoles.length === 1 ? "is" : "are"} not known to the system:`,
    );
    for (const role of meta.unknownRoles) out.push(`  ${role}`);
    out.push("");
    out.push("Matching compares a candidate's role against a seat's, and scores nothing for a");
    out.push("spelling it does not recognise. Role is 35 of the 100 points and a strong match");
    out.push("needs 70, so somebody stored under an unknown role can never be a strong match");
    out.push("for their own discipline, and nothing on screen says why.");
    out.push("");
    out.push("Either correct these in the roster, or, having checked that the tender seats use");
    out.push(`the same spelling, re-run with:  --accept-roles "${meta.unknownRoles.join(",")}"`);
    out.push("");
  }

  const s = plan.summary;
  const total = s.create + s.update + s.unchanged + s.reject;
  out.push(
    `${total} row${total === 1 ? "" : "s"}: ${s.create} create, ${s.update} update, ${s.unchanged} unchanged, ${s.reject} rejected.`,
  );
  out.push(
    meta.apply
      ? "Applied."
      : "Nothing written. Re-run with --apply once the report reads the way you expect.",
  );
  out.push("");
  out.push(
    "A row here holds no work history and no education. Anybody with a TiPP Focus CV should be loaded from the CV instead, which carries both.",
  );
  return out.join("\n");
}
