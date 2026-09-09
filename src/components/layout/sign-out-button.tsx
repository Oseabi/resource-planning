"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { endSession } from "@/app/(app)/audit-actions";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    // Closed before the session goes, because endSession needs the session it
    // is closing. A failure here is swallowed inside the action: the tab simply
    // stops beating, which is what an unclosed session looks like anyway.
    try {
      const id = sessionStorage.getItem("rp.session.id");
      if (id) {
        await endSession(id);
        sessionStorage.removeItem("rp.session.id");
      }
    } catch {
      // Storage blocked, or the action failed. Signing out still has to work.
    }

    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="flex items-center gap-2 text-body-sm text-muted-foreground hover:text-foreground"
    >
      <LogOut className="size-4" />
      Sign out
    </button>
  );
}
