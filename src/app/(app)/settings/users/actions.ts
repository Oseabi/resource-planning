"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProfileRole } from "@/lib/supabase/database.types";

export type CreateUserState = {
  error: string | null;
  credentials?: { email: string; password: string; appUrl: string };
};

export async function createEmployeeAccount(
  _prevState: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  await requireAdmin();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = (formData.get("role") as ProfileRole) ?? "user";

  if (!fullName || !email || password.length < 8) {
    return { error: "Name, email, and an 8+ character password are required." };
  }

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create the account." };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name: fullName,
    email,
    role,
    must_change_password: true,
  });

  if (profileError) {
    return { error: "Account created but profile setup failed. Please contact support." };
  }

  revalidatePath("/settings/users");

  return {
    error: null,
    credentials: {
      email,
      password,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    },
  };
}

export type ResetPasswordState = {
  error: string | null;
  credentials?: { email: string; password: string; appUrl: string };
};

export async function resetUserPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  await requireAdmin();

  const userId = String(formData.get("user_id") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!userId || password.length < 8) {
    return { error: "An 8+ character password is required." };
  }

  const admin = createAdminClient();
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });

  if (updateError) {
    return { error: updateError.message };
  }

  await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);

  revalidatePath("/settings/users");

  return {
    error: null,
    credentials: { email, password, appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "" },
  };
}

/**
 * Permanently remove a user's account.
 *
 * Deleting the auth user cascades to their profile, and every `created_by`
 * reference is set to null (migration 0011) so their candidates, requirements,
 * tenders, OEM letters and placements survive — only the attribution is lost.
 */
export async function deleteUser(userId: string): Promise<{ error: string | null }> {
  const currentUser = await requireAdmin();

  if (!userId) return { error: "Missing user id." };
  if (userId === currentUser.id) {
    return { error: "You cannot delete your own account." };
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (!target) return { error: "That user no longer exists." };

  // Removing the last admin would leave nobody able to manage users or delete
  // records, which cannot be undone from inside the app.
  if (target.role === "admin") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return { error: "This is the only admin. Promote another admin before deleting this one." };
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  revalidatePath("/settings/users");
  return { error: null };
}

export async function updateUserRole(userId: string, role: ProfileRole) {
  await requireAdmin();

  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/settings/users");
}
