/**
 * Reading an audit trail and a set of sessions.
 *
 * Pure, no I/O. The writes live in src/app/(app)/audit-actions.ts; everything
 * decidable about what the numbers mean lives here and is tested.
 *
 * The honest caveat, stated once here and repeated on screen: a session
 * measures time with the app open, not time spent working in it. Somebody who
 * leaves a tab open over lunch reads as an hour. There is no way to tell the
 * difference from a heartbeat, and pretending otherwise would put a precise
 * looking number next to a question it cannot answer.
 */

/** A session goes stale this long after its last heartbeat. */
export const SESSION_STALE_MS = 5 * 60 * 1000;
/** How often the browser beats. Comfortably inside the stale window. */
export const HEARTBEAT_MS = 2 * 60 * 1000;

export interface SessionRow {
  id: string;
  user_id: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  created_at: string;
}

/**
 * How long a session lasted, in milliseconds.
 *
 * Measured to the last heartbeat, never to now. A tab closed without signing
 * out simply stops beating, and counting the silence since would turn one
 * forgotten window into days of apparent use.
 */
export function sessionDuration(session: SessionRow): number {
  const start = Date.parse(session.started_at);
  const end = Date.parse(session.ended_at ?? session.last_seen_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

/** Still going: no sign-out, and a heartbeat inside the stale window. */
export function isSessionLive(session: SessionRow, now: number = Date.now()): boolean {
  if (session.ended_at) return false;
  const seen = Date.parse(session.last_seen_at);
  if (Number.isNaN(seen)) return false;
  return now - seen < SESSION_STALE_MS;
}

export interface UserUsage {
  userId: string;
  sessions: number;
  totalMs: number;
  /** The most recent sign-in, which is the "when did they last log in" answer. */
  lastSeenAt: string | null;
  firstSeenAt: string | null;
  live: boolean;
}

/**
 * Time in the system per person.
 *
 * Sessions are summed rather than measured end to end, so somebody who signs in
 * three times for twenty minutes reads as an hour rather than as the eight
 * hours between their first and last.
 */
export function usageByUser(sessions: SessionRow[], now: number = Date.now()): UserUsage[] {
  const byUser = new Map<string, UserUsage>();

  for (const s of sessions) {
    const found = byUser.get(s.user_id) ?? {
      userId: s.user_id,
      sessions: 0,
      totalMs: 0,
      lastSeenAt: null,
      firstSeenAt: null,
      live: false,
    };

    found.sessions += 1;
    found.totalMs += sessionDuration(s);
    if (!found.lastSeenAt || s.last_seen_at > found.lastSeenAt) found.lastSeenAt = s.last_seen_at;
    if (!found.firstSeenAt || s.started_at < found.firstSeenAt) found.firstSeenAt = s.started_at;
    if (isSessionLive(s, now)) found.live = true;

    byUser.set(s.user_id, found);
  }

  return [...byUser.values()].sort((a, b) => b.totalMs - a.totalMs);
}

/** "2h 14m", "18m", "under a minute". Never a bare number of milliseconds. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** The actions that are worth calling out in colour on a long list. */
const DESTRUCTIVE = new Set(["deleted", "unassigned", "purged"]);
const CREATIVE = new Set(["created", "imported", "placed", "assigned"]);

export type AuditTone = "destructive" | "creative" | "neutral";

export function auditTone(action: string): AuditTone {
  if (DESTRUCTIVE.has(action)) return "destructive";
  if (CREATIVE.has(action)) return "creative";
  return "neutral";
}

const ENTITY_LABELS: Record<string, string> = {
  candidate: "candidate",
  tender: "tender",
  job_requirement: "job requirement",
  oem_letter: "OEM letter",
  reference_letter: "reference letter",
  placement: "placement",
  assignment: "assignment",
  profile: "user",
  session: "session",
  department: "department",
  cv_upload: "CV",
  tender_upload: "tender document",
  setting: "setting",
};

/**
 * One line of the trail, as a sentence.
 *
 * The label is what the record was called at the time, which is why it is
 * copied into the row at write time rather than joined: by the time anybody
 * reads a deletion, the thing it names is gone.
 */
export function auditSentence(row: AuditRow): string {
  const who = row.actor_name ?? row.actor_email ?? "Somebody no longer on the system";
  const what = ENTITY_LABELS[row.entity_type] ?? row.entity_type;
  const named = row.entity_label ? ` "${row.entity_label}"` : "";

  if (row.action === "signed_in") return `${who} signed in`;
  if (row.action === "signed_out") return `${who} signed out`;
  // The one entry that records personal data leaving the country. Said in
  // full, because that is the line somebody will be looking for.
  if (row.action === "sent_for_ai_extraction") {
    return `${who} sent a CV${named} to Groq in the United States for AI extraction`;
  }
  if (row.action === "sent_tender_for_ai_extraction") {
    return `${who} sent a tender document${named} to Google's Gemini for AI extraction`;
  }
  if (row.action === "role_changed") return `${who} changed the role of user${named}`;
  if (row.action === "department_changed") return `${who} moved user${named} to another department`;
  return `${who} ${row.action} a ${what}${named}`;
}

export interface AuditCounts {
  created: number;
  deleted: number;
  updated: number;
  other: number;
}

/** Totals for the header, so the shape of a long list is visible at a glance. */
export function auditCounts(rows: AuditRow[]): AuditCounts {
  const counts: AuditCounts = { created: 0, deleted: 0, updated: 0, other: 0 };
  for (const r of rows) {
    if (r.action === "created" || r.action === "imported") counts.created += 1;
    else if (r.action === "deleted") counts.deleted += 1;
    else if (r.action === "updated") counts.updated += 1;
    else counts.other += 1;
  }
  return counts;
}

/** One person's usage, or null if they have never opened the app. */
export function usageForUser(
  sessions: SessionRow[],
  userId: string,
  now: number = Date.now(),
): UserUsage | null {
  return usageByUser(sessions.filter((s) => s.user_id === userId), now)[0] ?? null;
}

/** Their sessions, newest first, for a page that lists them one by one. */
export function sessionsForUser(sessions: SessionRow[], userId: string): SessionRow[] {
  return sessions
    .filter((s) => s.user_id === userId)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/**
 * What somebody actually spends their time doing, most frequent first.
 *
 * The counts a person is judged on should be legible without reading two
 * hundred lines, and "deleted 14" is the kind of thing worth seeing at the top
 * of a page rather than discovering by scrolling.
 */
export function actionBreakdown(rows: AuditRow[]): { action: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
  return [...counts.entries()]
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));
}

/** Everything one person did, newest first. */
export function trailForUser(rows: AuditRow[], userId: string): AuditRow[] {
  return rows
    .filter((r) => r.actor_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * The trail as a table, ready for toCsv.
 *
 * Deliberately flat and self-describing: somebody opening this in Excel a year
 * from now has no access to the ids, so the columns that matter are the names,
 * and they are the ones copied into each row at write time.
 */
export const AUDIT_CSV_HEADERS = [
  "when",
  "who",
  "email",
  "action",
  "what",
  "name",
  "entity_id",
] as const;

export function auditCsvRows(rows: AuditRow[]): (string | null)[][] {
  return rows.map((r) => [
    r.created_at,
    r.actor_name,
    r.actor_email,
    r.action,
    r.entity_type,
    r.entity_label,
    r.entity_id,
  ]);
}

export const SESSION_CSV_HEADERS = ["user", "email", "started", "last_seen", "ended", "minutes"] as const;

export function sessionCsvRows(
  sessions: SessionRow[],
  who: Map<string, { full_name: string; email: string }>,
): (string | number | null)[][] {
  return sessions.map((s) => {
    const person = who.get(s.user_id);
    return [
      person?.full_name ?? "Removed user",
      person?.email ?? null,
      s.started_at,
      s.last_seen_at,
      s.ended_at,
      Math.round(sessionDuration(s) / 60_000),
    ];
  });
}
