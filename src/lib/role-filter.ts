import { VOCABULARY } from "@/lib/vocabulary";

/**
 * Roles the candidate archive is organised by that the general vocabulary
 * does not name. Without them nearly half the pool (test analysts, Java and
 * C# developers, HR people, consultants) could not be reached from the role
 * filter at all, though the search box would find them.
 */
export const ARCHIVE_ROLES = [
  "Test Analyst",
  "Test Manager",
  "Test Engineer",
  "Test Lead",
  "Software Tester",
  "QA Analyst",
  "Java Developer",
  "C# Developer",
  ".NET Developer",
  "Application Developer",
  "Solution Architect",
  "Process Analyst",
  "HR Specialist",
  "HR Officer",
  "HR Administrator",
  "Management Consultant",
  "Project Administrator",
  "Financial Advisor",
  "Insurance Consultant",
  "Sales Consultant",
  "Claims Consultant",
] as const;

export interface RoleOption {
  role: string;
  count: number;
}

/**
 * The roles worth offering in the filter: every known role that at least one
 * candidate holds, with how many, most common first.
 *
 * "Holds" is the same test the list applies, a case-insensitive substring of
 * the current role, so the number beside an option is what choosing it shows
 * (before any other filter). A role chosen in the address but held by nobody
 * is kept, at zero, so the control can still show what is selected.
 */
export function roleOptions(currentRoles: (string | null)[], selected: string | null = null): RoleOption[] {
  const held = currentRoles.map((r) => (r ?? "").toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const out: RoleOption[] = [];
  for (const role of [...VOCABULARY.roles, ...ARCHIVE_ROLES]) {
    const key = role.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const count = held.filter((r) => r.includes(key)).length;
    if (count > 0) out.push({ role, count });
  }
  out.sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
  if (selected && !out.some((o) => o.role.toLowerCase() === selected.toLowerCase())) {
    const key = selected.toLowerCase();
    out.unshift({ role: selected, count: held.filter((r) => r.includes(key)).length });
  }
  return out;
}
