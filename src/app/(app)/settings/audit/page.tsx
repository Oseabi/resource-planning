import { redirect } from "next/navigation";
import { Clock, ShieldAlert, Users, Activity as ActivityIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { cn } from "@/lib/utils";
import {
  usageByUser,
  formatDuration,
  auditSentence,
  auditTone,
  auditCounts,
  isSessionLive,
  type SessionRow,
  type AuditRow,
} from "@/lib/audit";
import { EmptyState } from "@/components/layout/empty-state";

/** Long enough to be useful, short enough that the page stays readable. */
const TRAIL_LIMIT = 200;

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Who did what, and how much the system is actually used.
 *
 * Admin only, and deliberately not scoped by department: it records what
 * happened across the whole business, which is the point of having it.
 */
export default async function AuditPage() {
  const supabase = await createClient();
  const current = await getCurrentProfile();

  if (!current) redirect("/login");

  if (!current.isAdmin) {
    return (
      <div>
        <h1 className="text-display font-semibold text-foreground">Audit trail</h1>
        <p className="mt-2 text-body-md text-muted-foreground">
          Only admins can read the audit trail.
        </p>
      </div>
    );
  }

  const [{ data: trail }, { data: sessions }, { data: profiles }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, actor_id, actor_email, actor_name, action, entity_type, entity_id, entity_label, created_at")
      .order("created_at", { ascending: false })
      .limit(TRAIL_LIMIT),
    supabase.from("user_sessions").select("id, user_id, started_at, last_seen_at, ended_at"),
    supabase.from("profiles").select("id, full_name, email, role"),
  ]);

  const rows = (trail ?? []) as AuditRow[];
  const allSessions = (sessions ?? []) as SessionRow[];
  const counts = auditCounts(rows);
  const usage = usageByUser(allSessions);
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  const liveNow = allSessions.filter((s) => isSessionLive(s)).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold text-foreground">Audit trail</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Who created and deleted what, when people signed in, and how long they had the system
          open. Records cannot be edited or removed, by anyone.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Stat icon={<Users className="size-4" />} label="Signed in now" value={String(liveNow)} />
        <Stat
          icon={<ActivityIcon className="size-4" />}
          label="Created"
          value={String(counts.created)}
        />
        <Stat
          icon={<ShieldAlert className="size-4" />}
          label="Deleted"
          value={String(counts.deleted)}
          accent={counts.deleted > 0}
        />
        <Stat icon={<Clock className="size-4" />} label="People tracked" value={String(usage.length)} />
      </div>

      {/* ------------------------------------------------------- usage ---- */}
      <section className="rounded-lg border border-border bg-card shadow-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-headline-sm font-semibold text-foreground">Time in the system</h2>
          {/* Said plainly rather than implied. A heartbeat cannot tell a tab
              left open from somebody working, and a precise looking number
              next to a question it cannot answer is worse than no number. */}
          <p className="mt-1 text-body-sm text-muted-foreground">
            Measured while the app is open and the tab is in front, which is not the same as time
            spent working. Treat it as a usage signal, not a timesheet.
          </p>
        </div>
        {usage.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="Nothing recorded yet"
            description="Sessions start being counted the next time somebody opens the app."
          />
        ) : (
          <ul className="divide-y divide-border">
            {usage.map((u) => {
              const person = byId.get(u.userId);
              return (
                <li key={u.userId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">
                        {person?.full_name ?? "Removed user"}
                      </span>
                      {u.live && (
                        <span className="shrink-0 rounded-lg bg-success/10 px-2 py-0.5 text-label-sm font-medium text-success">
                          Online
                        </span>
                      )}
                    </div>
                    <div className="truncate text-body-sm text-muted-foreground">
                      {person?.email ?? "account deleted"}
                      {u.lastSeenAt && ` · last seen ${when(u.lastSeenAt)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-foreground">{formatDuration(u.totalMs)}</div>
                    <div className="text-body-sm text-muted-foreground">
                      {u.sessions} session{u.sessions === 1 ? "" : "s"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- trail ---- */}
      <section className="rounded-lg border border-border bg-card shadow-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-headline-sm font-semibold text-foreground">What happened</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">
            The {TRAIL_LIMIT} most recent entries, newest first. A deleted record still reads by
            the name it had, because that name is copied in when the entry is written.
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={ActivityIcon}
            title="Nothing recorded yet"
            description="Entries appear here as soon as anybody creates, deletes, or signs in."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const tone = auditTone(row.action);
              return (
                <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-2.5">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 font-mono text-label-sm",
                        tone === "destructive" && "bg-destructive/10 text-destructive",
                        tone === "creative" && "bg-success/10 text-success",
                        tone === "neutral" && "bg-muted text-muted-foreground",
                      )}
                    >
                      {row.action}
                    </span>
                    <span className="min-w-0 text-body-sm text-foreground">{auditSentence(row)}</span>
                  </div>
                  <span className="shrink-0 font-mono text-label-sm text-muted-foreground">
                    {when(row.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-label-sm uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-headline-lg font-semibold",
          accent ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
