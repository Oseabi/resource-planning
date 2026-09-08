import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRole } from "@/lib/supabase/database.types";

export interface CurrentProfile {
  id: string;
  email: string | null;
  fullName: string;
  role: ProfileRole;
  mustChangePassword: boolean;
  isAdmin: boolean;
  /** Admins can delete within a department too, so this is true for both. */
  isManager: boolean;
  /** The business unit this person belongs to. Null for admins, who see all four. */
  departmentId: string | null;
  /** Carried so the chrome can say which department a page is showing. */
  departmentName: string | null;
}

/**
 * The signed-in user, fetched at most once per request.
 *
 * `auth.getUser()` is a network call to Supabase, and the layout, the page, and
 * any helper on the same render each used to make their own, a detail page cost
 * six sequential round-trips before rendering. React's `cache()` dedupes them
 * across a single server render pass, so the layout and the page share one.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * The signed-in user together with their profile row, also once per request.
 * Selects every column the app needs (name, role, password state) so callers
 * never issue a second profiles query for a different column.
 */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  // The department is joined rather than fetched separately: this query already
  // runs once per request, and every caller that wants the id also wants the
  // name to put on screen.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, must_change_password, department_id, departments(name)")
    .eq("id", user.id)
    .single();

  const role = (profile?.role ?? "user") as ProfileRole;

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? user.email ?? "User",
    role,
    mustChangePassword: profile?.must_change_password ?? false,
    isAdmin: role === "admin",
    // A missing profile row degrades to "user" above, so this fails closed too.
    isManager: role === "admin" || role === "manager",
    departmentId: profile?.department_id ?? null,
    departmentName: profile?.departments?.name ?? null,
  };
});

/** Whether the signed-in user is an admin, without a second round-trip. */
export const isCurrentUserAdmin = cache(async (): Promise<boolean> => {
  const profile = await getCurrentProfile();
  return profile?.isAdmin ?? false;
});

/** Admin or department manager. Both can delete within a department. */
export const isCurrentUserManager = cache(async (): Promise<boolean> => {
  const profile = await getCurrentProfile();
  return profile?.isManager ?? false;
});
