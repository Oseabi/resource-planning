"use client";

import { useEffect, useRef } from "react";
import { HEARTBEAT_MS } from "@/lib/audit";
import { touchSession } from "@/app/(app)/audit-actions";

const STORAGE_KEY = "rp.session.id";

/**
 * Tells the server this person still has the app open.
 *
 * Renders nothing. Lives in the app layout so it survives navigation, and
 * keeps its id in sessionStorage so a full page reload continues the same
 * session rather than inflating the count with what is really one visit.
 *
 * What this measures is time with the app open, not time spent working in it.
 * Somebody who leaves a tab open over lunch reads as an hour. A heartbeat
 * cannot tell the difference, so the screen that shows these numbers says so
 * rather than implying a precision they do not have.
 *
 * It deliberately does not beat while the tab is hidden. That is the cheapest
 * honest improvement available: a background tab is not use, and skipping it
 * lets a forgotten window go stale on its own.
 */
export function SessionHeartbeat() {
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    try {
      sessionId.current = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      // Private browsing, or storage blocked. A new session each reload is a
      // worse number than a continued one, but it is not a reason to fail.
    }

    async function beat() {
      if (document.visibilityState !== "visible") return;
      try {
        const result = await touchSession(sessionId.current, navigator.userAgent);
        if (cancelled) return;
        if (result.sessionId && result.sessionId !== sessionId.current) {
          sessionId.current = result.sessionId;
          try {
            sessionStorage.setItem(STORAGE_KEY, result.sessionId);
          } catch {
            // As above.
          }
        }
      } catch {
        // A missed beat is a shorter session, never a broken page.
      }
    }

    void beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    // Beat on return, so coming back to a tab does not wait out the interval
    // and read as a gap that never happened.
    document.addEventListener("visibilitychange", beat);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
