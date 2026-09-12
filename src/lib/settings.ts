import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AccountManager } from "@/lib/supabase/database.types";

/**
 * Application settings: one row per key in app_settings.
 *
 * The account manager is the one setting so far. Every issued CV names her
 * on its cover page, and that used to be the only email and phone number on
 * the document, which is how her details ended up on five candidate records
 * before the reader learned to drop the cover. They live here, once, and an
 * admin changes them on the settings screen when the person changes.
 */

export const ACCOUNT_MANAGER_KEY = "account_manager";

/**
 * Printed when the settings table has no row yet, which is the state before
 * migration 0021 has run. The name is right; the contact details are blank
 * rather than a second copy of them in the source.
 */
export const DEFAULT_ACCOUNT_MANAGER: AccountManager = {
  name: "Samantha Africa",
  email: "",
  phone: "",
};

/** The saved value, or a typed default, never a throw. */
export function asAccountManager(value: unknown): AccountManager {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  return {
    name: str(v.name) || DEFAULT_ACCOUNT_MANAGER.name,
    email: str(v.email),
    phone: str(v.phone),
  };
}

/** Who the cover page names, as saved, with the default when nothing is. */
export async function loadAccountManager(): Promise<AccountManager> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", ACCOUNT_MANAGER_KEY)
    .maybeSingle();
  return data ? asAccountManager(data.value) : DEFAULT_ACCOUNT_MANAGER;
}
