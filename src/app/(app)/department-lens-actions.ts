"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient } from "@/lib/supabase/server";
import { LENS_COOKIE } from "@/lib/departments";

/**
 * Which department an admin is looking through.
 *
 * An admin has no department of their own, so the app shows them the group's
 * colours and every department's records. Choosing a lens recolours the app
 * in that department's accent and opens the lists on it, which is how an
 * admin sees what a Construction recruiter sees. Kept in a cookie rather
 * than on the profile: it is a way of looking, not a fact about the person,
 * and it must not survive into anybody else's session.
 *
 * Only an admin can set it, and it is only ever read for an admin.
 */
export async function setDepartmentLens(slug: string | null): Promise<void> {
  await requireAdmin();
  const store = await cookies();

  if (!slug) {
    store.delete(LENS_COOKIE);
  } else {
    const supabase = await createClient();
    const { data } = await supabase.from("departments").select("slug").eq("slug", slug).maybeSingle();
    if (!data) throw new Error("That department does not exist.");
    store.set(LENS_COOKIE, slug, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }

  // Every page under the layout reads the lens: the colours, the lists, the
  // default department on a new record.
  revalidatePath("/", "layout");
}
