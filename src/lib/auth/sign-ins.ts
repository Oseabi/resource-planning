import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Supabase Auth's own record of when each account last signed in.
 *
 * Read with the service role, which is why this is server-only and why the
 * two pages that call it check for an admin first. Auth has kept this date
 * since each account was created; the app's sessions only go back to the
 * day the heartbeat was switched on, so this is the record that answers
 * for everything before that.
 *
 * Best effort: an Auth outage leaves the page saying what the sessions say.
 */
export async function lastSignInsFromAuth(): Promise<Map<string, string>> {
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    return new Map(
      (data?.users ?? []).flatMap((u) => (u.last_sign_in_at ? [[u.id, u.last_sign_in_at] as const] : [])),
    );
  } catch {
    return new Map();
  }
}

/** The same, for one account. */
export async function lastSignInFromAuth(userId: string): Promise<string | null> {
  try {
    const { data } = await createAdminClient().auth.admin.getUserById(userId);
    return data?.user?.last_sign_in_at ?? null;
  } catch {
    return null;
  }
}
