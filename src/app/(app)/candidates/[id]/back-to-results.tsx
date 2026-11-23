"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { returnTarget } from "@/components/talent-chat/finder-return";

/**
 * The profile's way back when it was opened from the candidate finder.
 *
 * A step back in history, so the page underneath is exactly as it was and the
 * finder reopens on it with the same results. Opened in a new tab, there is
 * nothing to step back to, so it goes to the candidate list instead.
 */
export function BackToResults() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (returnTarget() ? router.back() : router.push("/candidates"))}
      className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Back to search results
    </button>
  );
}
