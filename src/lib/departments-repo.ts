import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { activeDepartment, resolveLens, LENS_COOKIE, type DepartmentBrand, type DepartmentOption } from "@/lib/departments";
import { GROUP_BRAND } from "@/lib/department-theme";
import type { CvBrand } from "@/lib/cv-export/brand";

export interface DepartmentContext {
  /**
   * The list a form should offer. Empty for anybody who is not an admin, which
   * is what makes the form render a read-only line instead of a picker: a
   * manager's bids go to their own department and the form does not ask.
   */
  options: DepartmentOption[];
  /** Every department, with its colour, for a page that needs to name or paint one. */
  all: DepartmentBrand[];
  ownDepartmentName: string | null;
  ownDepartmentId: string | null;
  isAdmin: boolean;
  /** The department an admin chose to look through. Null for everybody else. */
  lens: DepartmentBrand | null;
  /**
   * The department the app is seen through: a person's own, or the admin's
   * lens. What the chrome is coloured by and what the lists open on.
   */
  active: DepartmentBrand | null;
  /** The department the lists narrow to by default, or null for everything. */
  filterDepartmentId: string | null;
}

/**
 * What a form needs to know about departments, once per render.
 *
 * The I/O half of src/lib/departments.ts, the same split as positions.ts and
 * positions-repo.ts. The decisions are pure and tested over there; this only
 * fetches.
 */
export const loadDepartmentContext = cache(async (): Promise<DepartmentContext> => {
  const supabase = await createClient();
  const [profile, { data }, cookieStore] = await Promise.all([
    getCurrentProfile(),
    supabase.from("departments").select("id, name, slug, colour").order("sort_order"),
    cookies(),
  ]);

  const all: DepartmentBrand[] = data ?? [];
  const isAdmin = profile?.isAdmin ?? false;
  const own = all.find((d) => d.id === profile?.departmentId) ?? null;
  // The cookie is only read for an admin: anybody else's department is their
  // own, and a stale cookie from an admin session must not change that.
  const lens = isAdmin ? resolveLens(cookieStore.get(LENS_COOKIE)?.value, all) : null;
  const active = activeDepartment({ isAdmin, own, lens });

  return {
    options: isAdmin ? all : [],
    all,
    ownDepartmentName: profile?.departmentName ?? null,
    ownDepartmentId: profile?.departmentId ?? null,
    isAdmin,
    lens,
    active,
    filterDepartmentId: active?.id ?? null,
  };
});

/**
 * Whose name and colour a generated CV carries: the active department's,
 * with the group's teal standing in for one that has no colour yet. Null
 * for an admin looking through no department, whose CV is the plain one.
 */
export async function loadCvBrand(): Promise<CvBrand | null> {
  const { active } = await loadDepartmentContext();
  return active ? { name: active.name, colour: active.colour ?? GROUP_BRAND.colour } : null;
}
