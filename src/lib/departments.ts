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
