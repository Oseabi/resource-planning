/**
 * Which department a record belongs to, decided in one place.
 *
 * TiPP Focus runs four business units, each bidding its own work. The database
 * enforces the rule through RLS in 0018; this module decides what the app
 * should try in the first place, so a manager gets a sentence rather than an
 * opaque policy rejection.
 *
 * The security-relevant line is in resolveTenderDepartment: for anybody who is
 * not an admin the submitted value is **ignored**, not validated. The thing
 * that decides who can see a bid is never taken from the client.
 *
 * Pure, no I/O.
 */

export interface DepartmentOption {
  id: string;
  name: string;
  slug?: string;
}

/** A department with what the chrome needs: its handle and its colour. */
export interface DepartmentBrand extends DepartmentOption {
  slug: string;
  /** #RRGGBB from the corporate site, or null for one that has not been given a colour. */
  colour: string | null;
}

/**
 * The cookie an admin's chosen department is kept in: the department they
 * are looking at the app through. Only ever read for an admin.
 */
export const LENS_COOKIE = "rp.department";

/** The department a cookie names, or nothing when it names none of them. */
export function resolveLens(slug: string | null | undefined, all: DepartmentBrand[]): DepartmentBrand | null {
  if (!slug) return null;
  return all.find((d) => d.slug === slug) ?? null;
}

/**
 * The department the app is being seen through: a person's own, or the one
 * an admin chose. A lens on anybody but an admin is ignored, since their
 * own department is the one thing they cannot change.
 */
export function activeDepartment(input: {
  isAdmin: boolean;
  own: DepartmentBrand | null;
  lens: DepartmentBrand | null;
}): DepartmentBrand | null {
  return input.isAdmin ? input.lens : input.own;
}

/** Where a new candidate is filed until somebody says otherwise: the active department. */
export function defaultCandidateDepartments(active: DepartmentBrand | null): string[] {
  return active ? [active.id] : [];
}

/** The submitted departments that exist, once each, in the departments' own order. */
export function knownDepartmentIds(submitted: unknown, all: DepartmentOption[]): string[] {
  const wanted = new Set(Array.isArray(submitted) ? submitted.filter((v): v is string => typeof v === "string") : []);
  return all.filter((d) => wanted.has(d.id)).map((d) => d.id);
}

export type DepartmentFilter =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "one"; department: DepartmentBrand };

/**
 * What the candidates list shows. Absent means the default, the person's
 * own department when they have one; "all" and "none" are said explicitly,
 * so choosing "All departments" is never swallowed by the default; a value
 * that names no department is treated as everyone rather than nobody.
 */
export function parseDepartmentFilter(
  param: string | null | undefined,
  defaultId: string | null,
  all: DepartmentBrand[],
): DepartmentFilter {
  const wanted = param ?? defaultId ?? "all";
  if (wanted === "all") return { kind: "all" };
  if (wanted === "none") return { kind: "none" };
  const department = all.find((d) => d.id === wanted);
  return department ? { kind: "one", department } : { kind: "all" };
}

export type ShortlistDepartmentNote =
  | { kind: "outside"; departments: DepartmentBrand[] }
  | { kind: "none" }
  | null;

/**
 * What a shortlist says beside somebody from another department: their own
 * departments, so the bid team knows who they are borrowing from, or that
 * they are filed nowhere. Nothing for a person in the bid's own department,
 * and nothing at all when the bid has none.
 */
export function shortlistDepartmentNote(
  candidateIds: string[] | undefined,
  parentId: string | null,
  all: DepartmentBrand[],
): ShortlistDepartmentNote {
  if (!parentId) return null;
  const ids = candidateIds ?? [];
  if (ids.includes(parentId)) return null;
  const departments = all.filter((d) => ids.includes(d.id));
  return departments.length > 0 ? { kind: "outside", departments } : { kind: "none" };
}

/**
 * Where an admin's bid is filed when they have no department of their own
 * and have not picked one: the department they are looking through, else
 * Tipp Consulting, which bids most of the work. A default on the form, not
 * a rule on the server, so it shows in the Department field and can be
 * changed before the save.
 */
export const DEFAULT_TENDER_DEPARTMENT_SLUG = "consulting";

export function defaultTenderDepartment(
  departments: DepartmentOption[],
  ownDepartmentName: string | null,
  lensId: string | null = null,
): string | null {
  if (ownDepartmentName) return null;
  if (lensId && departments.some((d) => d.id === lensId)) return lensId;
  return departments.find((d) => d.slug === DEFAULT_TENDER_DEPARTMENT_SLUG)?.id ?? null;
}

export interface TenderDepartmentInput {
  isAdmin: boolean;
  /** The department of the person doing the saving. Null for most admins. */
  creatorDepartmentId: string | null;
  /** Whatever the form posted. Only consulted for an admin. */
  submittedDepartmentId: string | null;
  departments: DepartmentOption[];
}

/**
 * Where a new or edited bid should be filed.
 *
 * A manager never chooses: their bids land in their own department without the
 * form asking, which is right almost every time and removes a required field
 * from a form people fill in under deadline pressure. An admin works across all
 * four, so they choose, and their own department is the fallback.
 */
export function resolveTenderDepartment(
  input: TenderDepartmentInput,
): { departmentId: string | null; error: string | null } {
  const known = new Set(input.departments.map((d) => d.id));

  if (!input.isAdmin) {
    // Deliberately not validated against the submission. Reading the client's
    // value here, even to check it, invites the next person to trust it.
    if (!input.creatorDepartmentId) {
      return {
        departmentId: null,
        error:
          "You are not assigned to a department, so there is nowhere to file this. Ask an admin to assign you on the Users screen.",
      };
    }
    return { departmentId: input.creatorDepartmentId, error: null };
  }

  if (input.submittedDepartmentId && known.has(input.submittedDepartmentId)) {
    return { departmentId: input.submittedDepartmentId, error: null };
  }

  // An admin who picked nothing falls back to their own department, and an
  // admin with neither is asked, rather than having one chosen for them.
  if (input.creatorDepartmentId && known.has(input.creatorDepartmentId)) {
    return { departmentId: input.creatorDepartmentId, error: null };
  }

  return { departmentId: null, error: "Pick a department for this tender." };
}

/**
 * The department a bulk import should file its tenders under.
 *
 * The importers run on the service-role key, which bypasses RLS completely, so
 * nothing underneath will catch a mistake here. That is why an unrecognised
 * name is refused rather than guessed at, and why a missing one is refused
 * rather than defaulted: a hundred bids filed into a department nobody chose
 * are invisible to the people who own them, and nothing on screen says why.
 */
export function resolveImportDepartment(
  named: string | null,
  operatorDepartmentId: string | null,
  departments: DepartmentOption[],
): { departmentId: string | null; error: string | null } {
  const wanted = (named ?? "").trim().toLowerCase();

  if (wanted) {
    const found = departments.find(
      (d) => d.name.trim().toLowerCase() === wanted || (d.slug ?? "").toLowerCase() === wanted,
    );
    if (!found) {
      return {
        departmentId: null,
        error: `"${named!.trim()}" is not a department. Use one of: ${departments
          .map((d) => d.name)
          .join(", ")}`,
      };
    }
    return { departmentId: found.id, error: null };
  }

  if (operatorDepartmentId && departments.some((d) => d.id === operatorDepartmentId)) {
    return { departmentId: operatorDepartmentId, error: null };
  }

  return {
    departmentId: null,
    error: `No department for this row, and the operator has none to fall back on. Name one of: ${departments
      .map((d) => d.name)
      .join(", ")}`,
  };
}

/** The name to show, for a page that has an id and a list. */
export function departmentName(
  id: string | null,
  departments: DepartmentOption[],
): string | null {
  if (!id) return null;
  return departments.find((d) => d.id === id)?.name ?? null;
}
