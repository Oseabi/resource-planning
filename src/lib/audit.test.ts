import { describe, it, expect } from "vitest";
import {
  sessionDuration,
  isSessionLive,
  usageByUser,
  formatDuration,
  auditTone,
  auditSentence,
  auditCounts,
  SESSION_STALE_MS,
  type SessionRow,
  type AuditRow,
} from "@/lib/audit";

const NOW = Date.parse("2026-09-09T12:00:00Z");

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s1",
    user_id: "u1",
    started_at: "2026-09-09T10:00:00Z",
    last_seen_at: "2026-09-09T11:00:00Z",
    ended_at: null,
    ...over,
  };
}

function audit(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "a1",
    actor_id: "u1",
    actor_email: "n.khumalo@tippfocus.co.za",
    actor_name: "Nomsa Khumalo",
    action: "created",
    entity_type: "tender",
    entity_id: "t1",
    entity_label: "ERP support and maintenance",
    created_at: "2026-09-09T11:00:00Z",
    ...over,
  };
}

describe("sessionDuration", () => {
  it("measures to the last heartbeat, not to now", () => {
    // A tab closed without signing out simply stops beating. Counting the
    // silence since would turn one forgotten window into days of apparent use.
    expect(sessionDuration(session())).toBe(60 * 60 * 1000);
  });

  it("prefers a real sign-out over the last heartbeat", () => {
    const s = session({ ended_at: "2026-09-09T10:30:00Z" });
    expect(sessionDuration(s)).toBe(30 * 60 * 1000);
  });

  it("never returns a negative length", () => {
    const s = session({ started_at: "2026-09-09T11:00:00Z", last_seen_at: "2026-09-09T10:00:00Z" });
    expect(sessionDuration(s)).toBe(0);
  });

  it("has nothing to say about an unreadable timestamp", () => {
    expect(sessionDuration(session({ last_seen_at: "not a date" }))).toBe(0);
  });
});

describe("isSessionLive", () => {
  it("counts a recent heartbeat as still going", () => {
    const s = session({ last_seen_at: new Date(NOW - 60_000).toISOString() });
    expect(isSessionLive(s, NOW)).toBe(true);
  });

  it("counts silence past the stale window as over", () => {
    const s = session({ last_seen_at: new Date(NOW - SESSION_STALE_MS - 1000).toISOString() });
    expect(isSessionLive(s, NOW)).toBe(false);
  });

  it("counts a deliberate sign-out as over however recent", () => {
    const s = session({
      last_seen_at: new Date(NOW - 1000).toISOString(),
      ended_at: new Date(NOW - 1000).toISOString(),
    });
    expect(isSessionLive(s, NOW)).toBe(false);
  });
});

describe("usageByUser", () => {
  it("sums sessions rather than measuring first to last", () => {
    // Three twenty minute visits across a day are an hour of use, not the eight
    // hours between the first and the last.
    const rows = [
      session({ id: "a", started_at: "2026-09-09T08:00:00Z", last_seen_at: "2026-09-09T08:20:00Z" }),
      session({ id: "b", started_at: "2026-09-09T12:00:00Z", last_seen_at: "2026-09-09T12:20:00Z" }),
      session({ id: "c", started_at: "2026-09-09T16:00:00Z", last_seen_at: "2026-09-09T16:20:00Z" }),
    ];
    const usage = usageByUser(rows, NOW);
    expect(usage[0].sessions).toBe(3);
    expect(usage[0].totalMs).toBe(60 * 60 * 1000);
  });

  it("reports when somebody was last seen and first seen", () => {
    const rows = [
      session({ id: "a", started_at: "2026-09-01T08:00:00Z", last_seen_at: "2026-09-01T09:00:00Z" }),
      session({ id: "b", started_at: "2026-09-09T08:00:00Z", last_seen_at: "2026-09-09T09:00:00Z" }),
    ];
    const usage = usageByUser(rows, NOW);
    expect(usage[0].firstSeenAt).toBe("2026-09-01T08:00:00Z");
    expect(usage[0].lastSeenAt).toBe("2026-09-09T09:00:00Z");
  });

  it("keeps people apart", () => {
    const rows = [session({ user_id: "u1" }), session({ id: "s2", user_id: "u2" })];
    expect(usageByUser(rows, NOW)).toHaveLength(2);
  });

  it("puts the heaviest user first", () => {
    const rows = [
      session({ id: "a", user_id: "light", last_seen_at: "2026-09-09T10:10:00Z" }),
      session({ id: "b", user_id: "heavy", last_seen_at: "2026-09-09T14:00:00Z" }),
    ];
    expect(usageByUser(rows, NOW)[0].userId).toBe("heavy");
  });

  it("flags somebody who is signed in right now", () => {
    const rows = [
      session({ id: "old", last_seen_at: "2026-09-09T09:00:00Z" }),
      session({ id: "new", last_seen_at: new Date(NOW - 30_000).toISOString() }),
    ];
    expect(usageByUser(rows, NOW)[0].live).toBe(true);
  });

  it("has nothing to say about nobody", () => {
    expect(usageByUser([], NOW)).toEqual([]);
  });
});

describe("formatDuration", () => {
  it("does not pretend seconds are minutes", () => {
    expect(formatDuration(30_000)).toBe("under a minute");
  });

  it("reads in minutes below an hour", () => {
    expect(formatDuration(18 * 60_000)).toBe("18m");
  });

  it("drops a zero minute remainder", () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe("2h");
  });

  it("reads hours and minutes together", () => {
    expect(formatDuration(2 * 60 * 60_000 + 14 * 60_000)).toBe("2h 14m");
  });
});

describe("auditTone", () => {
  it("marks the destructive ones", () => {
    expect(auditTone("deleted")).toBe("destructive");
    expect(auditTone("unassigned")).toBe("destructive");
  });

  it("marks the creative ones", () => {
    expect(auditTone("created")).toBe("creative");
    expect(auditTone("imported")).toBe("creative");
  });

  it("leaves everything else alone", () => {
    expect(auditTone("updated")).toBe("neutral");
    expect(auditTone("signed_in")).toBe("neutral");
  });
});

describe("auditSentence", () => {
  it("reads as a sentence", () => {
    expect(auditSentence(audit())).toBe(
      'Nomsa Khumalo created a tender "ERP support and maintenance"',
    );
  });

  it("still names the record after it has been deleted", () => {
    // The label is copied in at write time precisely because the thing it names
    // is gone by the time anybody reads the deletion.
    const row = audit({ action: "deleted", entity_id: null });
    expect(auditSentence(row)).toContain('deleted a tender "ERP support and maintenance"');
  });

  it("still names the person after their account has been removed", () => {
    const row = audit({ actor_id: null, actor_name: null, actor_email: null });
    expect(auditSentence(row)).toMatch(/^Somebody no longer on the system/);
  });

  it("falls back to the address when there is no name", () => {
    expect(auditSentence(audit({ actor_name: null }))).toMatch(/^n\.khumalo@tippfocus\.co\.za/);
  });

  it("reads sign-in and sign-out without an entity", () => {
    expect(auditSentence(audit({ action: "signed_in", entity_type: "session" }))).toBe(
      "Nomsa Khumalo signed in",
    );
  });

  it("spells an entity type in words", () => {
    const row = audit({ entity_type: "job_requirement", entity_label: "BA x3" });
    expect(auditSentence(row)).toContain("a job requirement");
  });
});

describe("auditCounts", () => {
  it("counts an import as a creation", () => {
    const rows = [
      audit({ action: "created" }),
      audit({ action: "imported" }),
      audit({ action: "deleted" }),
      audit({ action: "updated" }),
      audit({ action: "signed_in" }),
    ];
    expect(auditCounts(rows)).toEqual({ created: 2, deleted: 1, updated: 1, other: 1 });
  });
});
