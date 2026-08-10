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
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, must_change_password")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? user.email ?? "User",
    role: (profile?.role ?? "user") as ProfileRole,
    mustChangePassword: profile?.must_change_password ?? false,
    isAdmin: profile?.role === "admin",
  };
});

/** Whether the signed-in user is an admin, without a second round-trip. */
export const isCurrentUserAdmin = cache(async (): Promise<boolean> => {
  const profile = await getCurrentProfile();
  return profile?.isAdmin ?? false;
});
