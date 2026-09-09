"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Writing the audit trail.
 *
 * Separate from activity-actions.ts on purpose. Activity is a timeline shown on
 * a record and is purged when that record is deleted; this is evidence and is
 * never purged, never updated, and readable only by admins. The two look alike
 * and answer opposite questions: "what has happened to this tender" against
 * "who deleted that tender, and when".
 *
 * Every write is best effort and swallows its own errors. An audit write that
 * throws would take down the action it was recording, which would be a worse
 * outcome than a missing line: losing the record of a deletion is bad, failing
 * to perform a deletion the user asked for because the logging broke is worse,
 * and the second is far more visible.
 */

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  /**
   * What the record was called at the time. Copied in rather than joined,
   * because by the time anybody reads a deletion the thing it names is gone.
   */
  entityLabel?: string | null;
  detail?: Json;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const [supabase, profile] = await Promise.all([createClient(), getCurrentProfile()]);

    await supabase.from("audit_log").insert({
      actor_id: profile?.id ?? null,
      // Denormalised so the line still names somebody after the account goes.
      actor_email: profile?.email ?? null,
      actor_name: profile?.fullName ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel ?? null,
      detail: input.detail ?? {},
    });
  } catch {
    // Deliberately silent. See the note at the top of this file.
  }
}

/**
 * Start or continue a session.
 *
 * Called once when the app loads and then on a timer. Passing an id moves that
 * session's heartbeat forward; passing none starts a new one and records the
 * sign-in. The browser holds the id, so a reload continues rather than
 * inflating the count with a session that is really the same visit.
 */
export async function touchSession(
  sessionId: string | null,
  userAgent?: string,
): Promise<{ sessionId: string | null }> {
  try {
    const [supabase, profile] = await Promise.all([createClient(), getCurrentProfile()]);
    if (!profile) return { sessionId: null };

    if (sessionId) {
      const { data } = await supabase
        .from("user_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("user_id", profile.id)
        .select("id");
      // Rows come back empty if the session was never ours or has gone. Falling
      // through starts a fresh one rather than beating into nothing.
      if (data && data.length > 0) return { sessionId };
    }

    const { data: created } = await supabase
      .from("user_sessions")
      .insert({ user_id: profile.id, user_agent: userAgent ?? null })
      .select("id")
      .single();

    if (created) {
      await recordAudit({ action: "signed_in", entityType: "session", entityId: created.id });
      return { sessionId: created.id };
    }
    return { sessionId: null };
  } catch {
    return { sessionId: null };
  }
}

/** Close a session deliberately, which is the only way ended_at is ever set. */
export async function endSession(sessionId: string): Promise<void> {
  try {
    const [supabase, profile] = await Promise.all([createClient(), getCurrentProfile()]);
    if (!profile) return;

    const now = new Date().toISOString();
    await supabase
      .from("user_sessions")
      .update({ ended_at: now, last_seen_at: now })
      .eq("id", sessionId)
      .eq("user_id", profile.id);

    await recordAudit({ action: "signed_out", entityType: "session", entityId: sessionId });
  } catch {
    // Best effort. A session that is never closed simply stops beating, which
    // is the common case anyway and which the duration maths already handles.
  }
}
