"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
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

  // Not checked against the departments here: the reader resolves the slug
  // against the list on every request and a slug that names nothing is the
  // group view. One query fewer on a round trip the person is waiting on.
  if (!slug || !/^[a-z0-9-]{1,40}$/.test(slug)) {
    store.delete(LENS_COOKIE);
  } else {
    store.set(LENS_COOKIE, slug, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }

  // Every page under the layout reads the lens: the colours, the lists, the
  // default department on a new record. The current page comes back
  // re-rendered with this response, so the caller has nothing more to fetch.
  revalidatePath("/", "layout");
}
