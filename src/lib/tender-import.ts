/**
 * Reading a tender register into the shape the app stores.
 *
 * Migration tooling, used once to load a spreadsheet that already exists.
 * Ongoing entry is the tender form, because bids are won weekly and a
 * spreadsheet stops being the truth the moment somebody edits a tender here.
 *
 * Everything decidable lives in this file and is unit-tested. The script in
 * scripts/ is only the I/O shell around it, the same split as positions.ts and
 * positions-repo.ts.
 *
 * Pure, no I/O.
 */

import type { CsvTable } from "@/lib/csv";
import type { PositionInput } from "@/lib/positions";
import type { TenderStatus } from "@/lib/supabase/database.types";

export const IMPORT_COLUMNS = [
  "title",
  "reference_number",
  "client",
  "location",
  "value",
  "submission_deadline",
  "contract_start_date",
  "contract_end_date",
  "status",
  "seats",
  "required_skills",
  "required_certifications",
  "sectors",
  "min_experience_years",
] as const;

const REQUIRED_COLUMNS = ["title"] as const;
const STATUSES: TenderStatus[] = ["draft", "live", "submitted", "won", "lost"];
/** Bids that have to be staffed, so a seatless row is a row nobody can answer for. */
const NEEDS_SEATS: TenderStatus[] = ["live", "submitted", "won"];

export interface SeatSpec {
  role: string;
  quantity: number;
  min_experience_years: number | null;
}

export interface ParsedTender {
  line: number;
  title: string;
  reference_number: string | null;
  client: string | null;
  location: string | null;
  value: number | null;
  submission_deadline: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  required_skills: string[];
  required_certifications: string[];
  sectors: string[];
  min_experience_years: number | null;
  status: TenderStatus;
  seats: SeatSpec[];
  /** Columns this row left blank. These are never written over an existing value. */
  blankColumns: string[];
  /** Role expansions applied, e.g. BA read as Business Analyst. Always reported. */
  notes: string[];
  warnings: string[];
}

export interface RowProblem {
  line: number;
  title: string;
  reasons: string[];
}

// -------------------------------------------------------------------------
// Cell readers
// -------------------------------------------------------------------------

/**
 * ISO dates only.
 *
 * "01/03/2026" is rejected rather than guessed. Day-month order differs by who
 * saved the file, and guessing wrong produces a contract that ends in the wrong
 * month, which nothing notices until somebody tries to extend it.
 */
export function parseImportDate(raw: string): { date: string | null; error: string | null } {
  const v = raw.trim();
  if (!v) return { date: null, error: null };

  const iso = v.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (!iso) {
    return { date: null, error: `"${v}" is not an unambiguous date, use yyyy-mm-dd` };
  }
  const [, y, m, d] = iso;
  const date = `${y}-${m}-${d}`;
  // Round-tripped through Date so 2026-02-30 is caught rather than stored.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { date: null, error: `"${v}" is not a real date` };
  }
  return { date, error: null };
}

/** Rand amounts as a register writes them: "R 12 500 000", "12,500,000". */
export function parseMoney(raw: string): { amount: number | null; error: string | null } {
  const v = raw.trim();
  if (!v) return { amount: null, error: null };

  // Non-breaking spaces come from Excel and are invisible in the file.
  const stripped = v
    .replace(/[Rr]\s*/, "")
    .replace(/[\s  ]/g, "")
    .replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(stripped)) {
    return { amount: null, error: `"${v}" is not a number this can read` };
  }
  return { amount: Number(stripped), error: null };
}

/** Pipe-separated everywhere, so there is one rule rather than a conditional one. */
export function parseList(raw: string): string[] {
  return raw
    .split("|")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseStatus(raw: string): TenderStatus | null {
  const v = raw.trim().toLowerCase();
  if (!v) return "draft";
  return (STATUSES as string[]).includes(v) ? (v as TenderStatus) : null;
}

export function parseCount(raw: string): { count: number | null; error: string | null } {
  const v = raw.trim();
  if (!v) return { count: null, error: null };
  if (!/^\d+(\.\d+)?$/.test(v)) return { count: null, error: `"${v}" is not a number` };
  const n = Number(v);
  if (n <= 0) return { count: null, error: `"${v}" has to be greater than zero` };
  return { count: n, error: null };
}

// -------------------------------------------------------------------------
// Roles
// -------------------------------------------------------------------------

/**
 * The abbreviations a register actually contains. Expanded, never silently: the
 * expansion is printed on the row, and the dry run is the review step.
 *
 * Rejecting every abbreviation would just move the re-keying into the
 * spreadsheet, and guessing beyond this list would be the same class of error
 * the whole check exists to prevent.
 */
const ROLE_ALIASES: Record<string, string> = {
  ba: "Business Analyst",
  "snr ba": "Business Analyst",
  "business analyst (ba)": "Business Analyst",
  sa: "Systems Analyst",
  pm: "Project Manager",
  "project mgr": "Project Manager",
  po: "Product Owner",
  sm: "Scrum Master",
  qs: "Quantity Surveyor",
  dba: "Database Administrator",
  "dev": "Software Developer",
  "developer": "Software Developer",
  "test analyst": "QA Engineer",
};

export interface RoleIndex {
  /** Lowercased known role to its canonical spelling. */
  canonical: Map<string, string>;
  aliases: Map<string, string>;
}

const normalizeRole = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Roles the system already knows: the vocabulary, plus whatever the candidate
 * pool actually calls itself.
 *
 * On the first import the pool is empty, which is correct. The vocabulary is
 * the only authority on day one.
 */
export function buildRoleIndex(
  vocabularyRoles: string[],
  candidateRoles: string[],
  /**
   * Roles the operator has confirmed for this run. The vocabulary cannot know
   * every discipline TiPP bids on, and blocking the whole register on a
   * legitimate role nobody thought to list would just make the check something
   * people work around. Naming them on the command line keeps the decision
   * explicit and visible in the report.
   */
  acceptedRoles: string[] = [],
): RoleIndex {
  const canonical = new Map<string, string>();
  for (const role of [...vocabularyRoles, ...candidateRoles, ...acceptedRoles]) {
    const key = normalizeRole(role);
    if (key && !canonical.has(key)) canonical.set(key, role.trim());
  }
  const aliases = new Map(Object.entries(ROLE_ALIASES));
  return { canonical, aliases };
}

/** The known roles closest to `input`, by shared word, for a rejection message. */
function nearestRoles(input: string, index: RoleIndex, limit = 3): string[] {
  const words = new Set(normalizeRole(input).split(" ").filter(Boolean));
  const scored: { role: string; shared: number }[] = [];
  for (const [key, role] of index.canonical) {
    const shared = key.split(" ").reduce((n, w) => (words.has(w) ? n + 1 : n), 0);
    if (shared > 0) scored.push({ role, shared });
  }
  return scored
    .sort((a, b) => b.shared - a.shared || a.role.length - b.role.length)
    .slice(0, limit)
    .map((s) => s.role);
}

/**
 * Resolve a role written in a spreadsheet to the exact spelling the system uses.
 *
 * This is the check that pays for the whole importer. roleMatch scores an exact
 * normalized match as 1 and otherwise counts shared tokens, so a seat labelled
 * "BA" shares nothing with a candidate whose role is "Business Analyst" and
 * scores 0 of role's 35 points. That caps every candidate at 65 against a
 * strong-match threshold of 70, so the seat can never have a strong match, the
 * coverage panel reports a shortfall on a bid you can comfortably staff, and
 * nothing on screen says why.
 */
export function resolveRole(
  input: string,
  index: RoleIndex,
): { role: string | null; via: "exact" | "alias" | null; suggestions: string[] } {
  const key = normalizeRole(input);
  if (!key) return { role: null, via: null, suggestions: [] };

  const exact = index.canonical.get(key);
  if (exact) return { role: exact, via: "exact", suggestions: [] };

  const alias = index.aliases.get(key);
  if (alias) {
    // An alias still has to name a role the system knows, otherwise the alias
    // map has drifted from the vocabulary and would introduce the very spelling
    // problem it exists to fix.
    const resolved = index.canonical.get(normalizeRole(alias));
    if (resolved) return { role: resolved, via: "alias", suggestions: [] };
  }

  return { role: null, via: null, suggestions: nearestRoles(input, index) };
}

/**
 * "3 x Business Analyst @5 | Project Manager @8 | 2 x Test Analyst"
 *
 * Quantity defaults to 1 and the experience floor to the row's own figure, so
 * the common case is just a list of role names.
 */
export function parseSeatsCell(
  raw: string,
  rowMinYears: number | null,
  index: RoleIndex,
): { seats: SeatSpec[]; errors: string[]; notes: string[]; unknown: string[] } {
  const seats: SeatSpec[] = [];
  const errors: string[] = [];
  const notes: string[] = [];
  const unknown: string[] = [];

  for (const entry of parseList(raw)) {
    const match = entry.match(/^(?:(\d+)\s*[xX*]\s*)?(.+?)(?:\s*@\s*(\d+(?:\.\d+)?))?$/);
    if (!match) {
      errors.push(`"${entry}" is not a seat this can read`);
      continue;
    }
    const [, qtyRaw, roleRaw, yearsRaw] = match;
    const quantity = qtyRaw ? Number(qtyRaw) : 1;
    if (quantity <= 0) {
      errors.push(`"${entry}" asks for ${quantity} people`);
      continue;
    }

    const { role, via, suggestions } = resolveRole(roleRaw, index);
    if (!role) {
      unknown.push(roleRaw.trim());
      errors.push(
        suggestions.length > 0
          ? `"${roleRaw.trim()}" is not a known role. Closest: ${suggestions.join(", ")}`
          : `"${roleRaw.trim()}" is not a known role`,
      );
      continue;
    }
    if (via === "alias") notes.push(`"${roleRaw.trim()}" read as "${role}"`);

    seats.push({
      role,
      quantity,
      min_experience_years: yearsRaw ? Number(yearsRaw) : rowMinYears,
    });
  }

  // Two lines of the same role at the same floor cannot be told apart when the
  // importer is re-run, so the quantity has to be combined in the sheet instead.
  const seen = new Set<string>();
  for (const seat of seats) {
    const key = `${normalizeRole(seat.role)}|${seat.min_experience_years ?? ""}`;
    if (seen.has(key)) {
      errors.push(`"${seat.role}" appears twice at the same experience level, combine the quantity`);
    }
    seen.add(key);
  }

  return { seats, errors, notes, unknown };
}

// -------------------------------------------------------------------------
// Rows
// -------------------------------------------------------------------------

export function readRows(
  table: CsvTable,
  index: RoleIndex,
): { parsed: ParsedTender[]; problems: RowProblem[]; unknownRoles: string[] } {
  const problems: RowProblem[] = [];
  // Gathered across the whole file rather than reported row by row, so the
  // operator can settle every unknown spelling in one pass instead of
  // rediscovering the same one on thirty rows.
  const unknownRoles = new Set<string>();

  // An unknown header is an error, not a warning. A typo that silently drops
  // the contract end date for a hundred rows is the kind of thing found six
  // months later by somebody trying to extend a contract.
  const known = new Set<string>(IMPORT_COLUMNS);
  const unknown = table.headers.filter((h) => h && !known.has(h));
  const missing = REQUIRED_COLUMNS.filter((c) => !table.headers.includes(c));
  if (unknown.length > 0 || missing.length > 0) {
    const reasons: string[] = [];
    if (missing.length > 0) reasons.push(`missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
    if (unknown.length > 0) reasons.push(`unrecognised column${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
    return { parsed: [], problems: [{ line: 1, title: "header row", reasons }], unknownRoles: [] };
  }

  for (const p of table.problems) {
    problems.push({ line: p.line, title: "unreadable row", reasons: [p.message] });
  }

  const parsed: ParsedTender[] = [];

  for (const row of table.rows) {
    const cell = (name: string) => row.cells[name] ?? "";
    const reasons: string[] = [];
    const warnings: string[] = [];
    const notes: string[] = [];

    const title = cell("title").trim();
    if (!title) reasons.push("no title");

    const status = parseStatus(cell("status"));
    if (status === null) {
      // Never defaulted. Reading an unrecognised status as draft would quietly
      // turn won bids into drafts, and nothing downstream would look wrong.
      reasons.push(`"${cell("status")}" is not one of ${STATUSES.join(", ")}`);
    }

    const deadline = parseImportDate(cell("submission_deadline"));
    if (deadline.error) reasons.push(`submission_deadline: ${deadline.error}`);
    const start = parseImportDate(cell("contract_start_date"));
    if (start.error) reasons.push(`contract_start_date: ${start.error}`);
    const end = parseImportDate(cell("contract_end_date"));
    if (end.error) reasons.push(`contract_end_date: ${end.error}`);
    if (start.date && end.date && end.date < start.date) {
      reasons.push("the contract ends before it starts");
    }

    const money = parseMoney(cell("value"));
    if (money.error) reasons.push(`value: ${money.error}`);

    const years = parseCount(cell("min_experience_years"));
    if (years.error) reasons.push(`min_experience_years: ${years.error}`);

    const seatResult = parseSeatsCell(cell("seats"), years.count, index);
    reasons.push(...seatResult.errors.map((e) => `seats: ${e}`));
    notes.push(...seatResult.notes);
    for (const u of seatResult.unknown) unknownRoles.add(u);

    if (status && NEEDS_SEATS.includes(status) && seatResult.seats.length === 0) {
      reasons.push(`a ${status} bid has to say what it needs to be staffed with`);
    }

    if (!cell("reference_number").trim()) warnings.push("no reference number");
    if (!cell("client").trim()) warnings.push("no client");
    if (status === "won" && !start.date) warnings.push("won with no contract start date, so coverage cannot be checked");

    if (reasons.length > 0) {
      problems.push({ line: row.line, title: title || "(no title)", reasons });
      continue;
    }

    const blankColumns = IMPORT_COLUMNS.filter((c) => !cell(c).trim());

    parsed.push({
      line: row.line,
      title,
      reference_number: cell("reference_number").trim() || null,
      client: cell("client").trim() || null,
      location: cell("location").trim() || null,
      value: money.amount,
      submission_deadline: deadline.date,
      contract_start_date: start.date,
      contract_end_date: end.date,
      required_skills: parseList(cell("required_skills")),
      required_certifications: parseList(cell("required_certifications")),
      sectors: parseList(cell("sectors")),
      min_experience_years: years.count,
      status: status!,
      seats: seatResult.seats,
      blankColumns,
      notes,
      warnings,
    });
  }

  return { parsed, problems, unknownRoles: [...unknownRoles].sort() };
}

// -------------------------------------------------------------------------
// Reconciling against what is already stored
// -------------------------------------------------------------------------

export interface ExistingPosition {
  id: string;
  role: string;
  quantity: number;
  min_experience_years: number | null;
  /** People sitting in this seat. A seat with anybody in it is never removed. */
  assignments: number;
}

export interface ExistingTender {
  id: string;
  reference_number: string | null;
  title: string;
  client: string | null;
  columns: Record<string, unknown>;
  positions: ExistingPosition[];
}

export interface SeatPlan {
  /** Ready for the write step. Matched lines carry their existing id. */
  positions: PositionInput[];
  removed: { id: string; role: string }[];
  blocked: { id: string; role: string; assignments: number }[];
  changed: boolean;
}

const seatKey = (role: string, years: number | null) => `${normalizeRole(role)}|${years ?? ""}`;

/**
 * Work out which seats to keep, add and drop.
 *
 * Matched on role and experience floor together, not role alone. "Three
 * analysts at 3 years and a lead at 5" is two legitimate lines of the same
 * role, so only the pair identifies a seat.
 *
 * Matched lines carry their existing id, which is what lets a re-run leave the
 * assignments and match rows on those seats alone. Deleting and re-inserting
 * would throw away everybody's shortlist every time the spreadsheet was fixed.
 */
export function reconcileSeats(existing: ExistingPosition[], wanted: SeatSpec[]): SeatPlan {
  const byKey = new Map(existing.map((p) => [seatKey(p.role, p.min_experience_years), p]));
  const positions: PositionInput[] = [];
  const matchedIds = new Set<string>();
  let changed = false;

  for (const seat of wanted) {
    const found = byKey.get(seatKey(seat.role, seat.min_experience_years));
    if (found) {
      matchedIds.add(found.id);
      if (found.quantity !== seat.quantity) changed = true;
      positions.push({
        id: found.id,
        role: seat.role,
        quantity: seat.quantity,
        min_experience_years: seat.min_experience_years,
        required_skills: [],
        required_certifications: [],
      });
    } else {
      changed = true;
      positions.push({
        role: seat.role,
        quantity: seat.quantity,
        min_experience_years: seat.min_experience_years,
        required_skills: [],
        required_certifications: [],
      });
    }
  }

  const removed: { id: string; role: string }[] = [];
  const blocked: { id: string; role: string; assignments: number }[] = [];

  for (const p of existing) {
    if (matchedIds.has(p.id)) continue;
    if (p.assignments > 0) {
      // Somebody put a person in that chair. A spreadsheet is not allowed to
      // take them out of it.
      blocked.push({ id: p.id, role: p.role, assignments: p.assignments });
      positions.push({
        id: p.id,
        role: p.role,
        quantity: p.quantity,
        min_experience_years: p.min_experience_years,
        required_skills: [],
        required_certifications: [],
      });
    } else {
      changed = true;
      removed.push({ id: p.id, role: p.role });
    }
  }

  return { positions, removed, blocked, changed };
}

// -------------------------------------------------------------------------
// The plan
// -------------------------------------------------------------------------

export interface ColumnChange {
  column: string;
  from: unknown;
  to: unknown;
}

export type RowPlan =
  | { kind: "create"; row: ParsedTender; seats: SeatPlan }
  | { kind: "update"; row: ParsedTender; targetId: string; columnChanges: ColumnChange[]; seats: SeatPlan; leftAlone: string[] }
  | { kind: "unchanged"; row: ParsedTender; targetId: string }
  | { kind: "reject"; line: number; title: string; reasons: string[] };

export interface ImportPlan {
  plans: RowPlan[];
  summary: { create: number; update: number; unchanged: number; reject: number };
}

const normalizeRef = (v: string | null) => (v ? v.trim().replace(/\s+/g, " ").toUpperCase() : null);

/** Columns the CSV owns. required_roles is derived from the seats, not a column. */
const WRITABLE = [
  "title",
  "reference_number",
  "client",
  "location",
  "value",
  "submission_deadline",
  "contract_start_date",
  "contract_end_date",
  "status",
  "min_experience_years",
] as const;
const LIST_COLUMNS = ["required_skills", "required_certifications", "sectors"] as const;

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function buildPlan(parsed: ParsedTender[], existing: ExistingTender[]): ImportPlan {
  const plans: RowPlan[] = [];

  const byRef = new Map<string, ExistingTender[]>();
  const byTitleClient = new Map<string, ExistingTender[]>();
  for (const t of existing) {
    const ref = normalizeRef(t.reference_number);
    if (ref) byRef.set(ref, [...(byRef.get(ref) ?? []), t]);
    const key = `${t.title.trim().toLowerCase()}|${(t.client ?? "").trim().toLowerCase()}`;
    byTitleClient.set(key, [...(byTitleClient.get(key) ?? []), t]);
  }

  // A reference appearing twice in the file cannot be resolved to one record,
  // and creating both would be the duplicate this whole scheme exists to avoid.
  const refCounts = new Map<string, number>();
  for (const row of parsed) {
    const ref = normalizeRef(row.reference_number);
    if (ref) refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
  }

  for (const row of parsed) {
    const ref = normalizeRef(row.reference_number);

    if (ref && (refCounts.get(ref) ?? 0) > 1) {
      plans.push({
        kind: "reject",
        line: row.line,
        title: row.title,
        reasons: [`reference ${row.reference_number} appears more than once in this file`],
      });
      continue;
    }

    let matches: ExistingTender[] = [];
    if (ref) {
      matches = byRef.get(ref) ?? [];
    } else {
      const key = `${row.title.trim().toLowerCase()}|${(row.client ?? "").trim().toLowerCase()}`;
      matches = byTitleClient.get(key) ?? [];
    }

    if (matches.length > 1) {
      // Rejected rather than guessed. The failure mode of an importer must be a
      // rejected row, never a duplicate nobody notices.
      plans.push({
        kind: "reject",
        line: row.line,
        title: row.title,
        reasons: [
          ref
            ? `reference ${row.reference_number} already matches ${matches.length} tenders`
            : `title and client already match ${matches.length} tenders, give this row a reference number`,
        ],
      });
      continue;
    }

    if (matches.length === 0) {
      plans.push({ kind: "create", row, seats: reconcileSeats([], row.seats) });
      continue;
    }

    const target = matches[0];
    const columnChanges: ColumnChange[] = [];
    const leftAlone: string[] = [];

    for (const column of WRITABLE) {
      const to = (row as unknown as Record<string, unknown>)[column];
      const from = target.columns[column] ?? null;
      // A blank cell means "not in the register", never "clear this". Without
      // this, a re-run silently erases every correction made in the app.
      if (to === null || to === "") {
        if (from !== null && from !== "") leftAlone.push(column);
        continue;
      }
      if (from !== to) columnChanges.push({ column, from, to });
    }

    for (const column of LIST_COLUMNS) {
      const to = (row as unknown as Record<string, string[]>)[column];
      const from = (target.columns[column] as string[] | undefined) ?? [];
      if (to.length === 0) {
        if (from.length > 0) leftAlone.push(column);
        continue;
      }
      if (!sameList(from, to)) columnChanges.push({ column, from, to });
    }

    const seats = reconcileSeats(target.positions, row.seats);

    if (columnChanges.length === 0 && !seats.changed) {
      plans.push({ kind: "unchanged", row, targetId: target.id });
      continue;
    }

    plans.push({ kind: "update", row, targetId: target.id, columnChanges, seats, leftAlone });
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

/** The distinct seat roles, which the tender detail page renders as its role tags. */
export function rolesFromSeats(seats: SeatSpec[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const seat of seats) {
    const key = normalizeRole(seat.role);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(seat.role);
    }
  }
  return out;
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
  /** Every role spelling in the file the system does not recognise. */
  unknownRoles?: string[];
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "blank";
  if (Array.isArray(v)) return v.length === 0 ? "blank" : v.join(" | ");
  return String(v);
};

const seatLine = (seats: { role: string; quantity: number; min_experience_years: number | null }[]) =>
  seats
    .map((s) => `${s.quantity} x ${s.role}${s.min_experience_years ? ` (${s.min_experience_years}y)` : ""}`)
    .join(", ");

/**
 * The report is the review step, so it has to say what would happen and why,
 * not just how many rows there were. The seat line matters most: seats drive
 * matching and the coverage check, and a spreadsheet carries them worst.
 */
export function formatPlan(plan: ImportPlan, meta: ReportMeta): string {
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
      out.push(`row ${p.line}  REJECT  "${p.title}"`);
      for (const reason of p.reasons) out.push(`        ${reason}`);
      out.push("");
      continue;
    }

    const ref = p.row.reference_number ? `  ref ${p.row.reference_number}` : "";

    if (p.kind === "unchanged") {
      out.push(`row ${p.row.line}  UNCHANGED  "${p.row.title}"${ref}`);
      out.push("");
      continue;
    }

    if (p.kind === "create") {
      out.push(`row ${p.row.line}  CREATE  "${p.row.title}"${ref}`);
      if (p.row.client) out.push(`        client     ${p.row.client}`);
      if (p.row.contract_start_date) {
        out.push(
          `        contract   ${p.row.contract_start_date} to ${p.row.contract_end_date ?? "open ended"}`,
        );
      }
      if (p.seats.positions.length > 0) {
        const total = p.seats.positions.reduce((n, s) => n + s.quantity, 0);
        out.push(`        seats      ${seatLine(p.row.seats)}  = ${total} seat${total === 1 ? "" : "s"}`);
      }
      for (const note of p.row.notes) out.push(`        note       ${note}`);
      for (const w of p.row.warnings) out.push(`        warn       ${w}`);
      out.push("");
      continue;
    }

    out.push(`row ${p.row.line}  UPDATE  "${p.row.title}"${ref}  -> tender ${p.targetId}`);
    for (const c of p.columnChanges) {
      out.push(`        ${c.column.padEnd(20)} ${show(c.from)} -> ${show(c.to)}`);
    }
    for (const column of p.leftAlone) {
      out.push(`        ${column.padEnd(20)} left alone, blank in the register`);
    }
    if (p.seats.changed) out.push(`        seats                ${seatLine(p.row.seats)}`);
    for (const r of p.seats.removed) out.push(`        removing seat        ${r.role}`);
    for (const b of p.seats.blocked) {
      out.push(
        `        keeping seat         ${b.role}: ${b.assignments} person${b.assignments === 1 ? "" : "s"} assigned to it`,
      );
    }
    for (const note of p.row.notes) out.push(`        note                 ${note}`);
    for (const w of p.row.warnings) out.push(`        warn                 ${w}`);
    out.push("");
  }

  // Listed once at the end rather than repeated on every row that used them.
  // This is the block that decides whether matching will work at all, so it is
  // the last thing read before deciding to apply.
  if (meta.unknownRoles && meta.unknownRoles.length > 0) {
    out.push(
      `${meta.unknownRoles.length} role spelling${meta.unknownRoles.length === 1 ? "" : "s"} in this register ${meta.unknownRoles.length === 1 ? "is" : "are"} not known to the system:`,
    );
    for (const role of meta.unknownRoles) out.push(`  ${role}`);
    out.push("");
    out.push("Matching compares a seat's role against a candidate's, and scores nothing for a");
    out.push("spelling it does not recognise. Role is 35 of the 100 points and a strong match");
    out.push("needs 70, so a seat labelled with an unknown role can never have one, and the");
    out.push("coverage panel will report a shortfall on a bid you can comfortably staff.");
    out.push("");
    out.push("Either correct these in the register, or, having checked that the CVs use the");
    out.push(`same spelling, re-run with:  --accept-roles "${meta.unknownRoles.join(",")}"`);
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
    "This tool is for the initial load. Once tenders are being edited in the app, the app is the record and a re-run would overwrite decisions made there.",
  );
  return out.join("\n");
}
