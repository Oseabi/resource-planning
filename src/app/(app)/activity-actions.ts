"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActivityEntityType, Json } from "@/lib/supabase/database.types";

export interface ActivityEntry {
  id: string;
  kind: "note" | "event";
  action: string | null;
  body: string | null;
  detail: Record<string, unknown>;
  actorName: string;
  actorId: string | null;
  createdAt: string;
  /** True when the signed-in user may remove it (own note, or any as admin). */
  canDelete: boolean;
}

const PATH_BY_TYPE: Record<ActivityEntityType, string> = {
  candidate: "/candidates",
  tender: "/tenders",
  job_requirement: "/job-requirements",
  oem_letter: "/oem-letters",
};

/** Long enough for real context, short enough to stay a note and not a document. */
const MAX_NOTE_LENGTH = 2000;

/**
 * Record something the system did.
 *
 * Deliberately never throws and never returns an error. Every caller is a
 * server action doing real work (assigning someone, deleting a record), and
 * failing that work because the audit line could not be written would be the
 * wrong trade. A missing timeline entry is a much smaller problem than a
 * half-completed assignment.
 */
export async function recordEvent(
  entityType: ActivityEntityType,
  entityId: string,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from("activity").insert({
      entity_type: entityType,
      entity_id: entityId,
      kind: "event",
      action,
      detail: detail as Json,
      actor_id: user?.id ?? null,
    });
  } catch {
    // See above: the trail is best-effort, the work it describes is not.
  }
}

export async function addNote(
  entityType: ActivityEntityType,
  entityId: string,
  body: string,
): Promise<{ error: string | null }> {
  const text = body.trim();
  if (!text) return { error: "Write something first." };
  if (text.length > MAX_NOTE_LENGTH) {
    return { error: `Notes are limited to ${MAX_NOTE_LENGTH} characters.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are not signed in." };

  const { error } = await supabase.from("activity").insert({
    entity_type: entityType,
    entity_id: entityId,
    kind: "note",
    body: text,
    actor_id: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`${PATH_BY_TYPE[entityType]}/${entityId}`);
  return { error: null };
}

/**
 * Drop a record's whole timeline, for when the record itself is deleted.
 *
 * `entity_id` is polymorphic so no foreign key backs it and nothing cascades.
 * Without this, deleting a candidate leaves their notes and events behind,
 * pointing at an id that no longer resolves. Hand-rolled the same way the
 * cascades for parent_id and match_target_id already are.
 *
 * Best-effort, like recordEvent: the delete it accompanies has already
 * succeeded, so failing here must not turn a completed delete into an error.
 */
export async function purgeActivity(
  entityType: ActivityEntityType,
  entityId: string,
): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase
      .from("activity")
      .delete()
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
  } catch {
    // See above.
  }
}

export async function deleteNote(
  entityType: ActivityEntityType,
  entityId: string,
  activityId: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  // RLS decides whether this is allowed: your own note, or anything as admin.
  const { error } = await supabase.from("activity").delete().eq("id", activityId);
  if (error) return { error: error.message };

  revalidatePath(`${PATH_BY_TYPE[entityType]}/${entityId}`);
  return { error: null };
}

/**
 * The timeline for one record, newest first.
 *
 * Actor names come from a second query rather than a join, because activity has
 * no foreign key to profiles that PostgREST could follow, and because most
 * timelines are written by a handful of people.
 */
export async function loadActivity(
  entityType: ActivityEntityType,
  entityId: string,
  limit = 50,
): Promise<ActivityEntry[]> {
  const supabase = await createClient();

  const [{ data: rows }, { data: auth }] = await Promise.all([
    supabase
      .from("activity")
      .select("id, kind, action, body, detail, actor_id, created_at")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.auth.getUser(),
  ]);

  if (!rows || rows.length === 0) return [];

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  let isAdmin = false;

  if (auth.user) {
    const { data: me } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", auth.user.id)
      .single();
    isAdmin = me?.role === "admin";
  }

  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    action: r.action,
    body: r.body,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    actorId: r.actor_id,
    // actor_id survives the user being deleted, but the profile does not.
    actorName: r.actor_id ? (names.get(r.actor_id) ?? "Removed user") : "System",
    createdAt: r.created_at,
    canDelete: isAdmin || (r.kind === "note" && r.actor_id === auth.user?.id),
  }));
}
