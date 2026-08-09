import "server-only";
import { getCurrentProfile } from "@/lib/auth/current-user";

export async function requireAdmin() {
  // Request-cached, so calling this alongside other auth reads in the same
  // action costs a single auth + profile round-trip rather than one each.
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Not authenticated.");
  }

  if (!profile.isAdmin) {
    throw new Error("Only admins can perform this action.");
  }

  return profile;
}
