import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import type { DepartmentOption } from "@/lib/departments";

export interface DepartmentContext {
  /**
   * The list a form should offer. Empty for anybody who is not an admin, which
   * is what makes the form render a read-only line instead of a picker: a
   * manager's bids go to their own department and the form does not ask.
   */
  options: DepartmentOption[];
  /** Every department, for a page that needs to name one it does not own. */
  all: DepartmentOption[];
  ownDepartmentName: string | null;
  ownDepartmentId: string | null;
  isAdmin: boolean;
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
  const [profile, { data }] = await Promise.all([
    getCurrentProfile(),
    supabase.from("departments").select("id, name, slug").order("sort_order"),
  ]);

  const all = data ?? [];
  const isAdmin = profile?.isAdmin ?? false;

  return {
    options: isAdmin ? all : [],
    all,
    ownDepartmentName: profile?.departmentName ?? null,
    ownDepartmentId: profile?.departmentId ?? null,
    isAdmin,
  };
});
