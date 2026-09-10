import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, Clock, LogIn, FilePlus2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/layout/empty-state";
import { ExportButton } from "@/app/(app)/settings/audit/export-button";
import {
  usageForUser,
  sessionsForUser,
  actionBreakdown,
  auditCounts,
  auditSentence,
  auditTone,
  sessionDuration,
  isSessionLive,
  formatDuration,
  auditCsvRows,
  sessionCsvRows,
  AUDIT_CSV_HEADERS,
  SESSION_CSV_HEADERS,
  type AuditRow,
  type SessionRow,
} from "@/lib/audit";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  user: "User",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const slug = (v: string) => v.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

/**
 * Everything one person has done, and every time they were here.
 *
 * Their whole trail rather than a recent slice: the point of opening a single
 * person's page is usually a specific question about a specific day, and a cap
 * would silently hide the answer.
 */
export default async function PersonAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const [{ data: person }, { data: trail }, { data: sessions }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, role, department_id, departments(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("audit_log")
      .select("id, actor_id, actor_email, actor_name, action, entity_type, entity_id, entity_label, created_at")
      .eq("actor_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("user_sessions")
      .select("id, user_id, started_at, last_seen_at, ended_at")
      .eq("user_id", id),
  ]);

  if (!person) notFound();

  const rows = (trail ?? []) as AuditRow[];
  const theirSessions = sessionsForUser((sessions ?? []) as SessionRow[], id);
  const usage = usageForUser(theirSessions, id);
  const counts = auditCounts(rows);
  const breakdown = actionBreakdown(rows);
  const department = person.departments?.name ?? null;
  const who = new Map([[id, { full_name: person.full_name, email: person.email }]]);

  return (
    <div className="space-y-6">
      <Link
        href="/settings/audit"
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to the audit trail
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">{person.full_name}</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">{person.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-muted px-2 py-0.5 text-label-md font-medium text-foreground">
              {ROLE_LABELS[person.role] ?? person.role}
            </span>
            <span className="rounded-lg bg-muted px-2 py-0.5 text-label-md text-muted-foreground">
              {department ?? "No department"}
            </span>
            {usage?.live && (
              <span className="rounded-lg bg-success/10 px-2 py-0.5 text-label-md font-medium text-success">
                Online
              </span>
            )}
          </div>
        </div>
        <ExportButton
          headers={[...AUDIT_CSV_HEADERS]}
          rows={auditCsvRows(rows)}
          filename={`${slug(person.full_name)}-audit.csv`}
          label="Export their trail"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Stat
          icon={<Clock className="size-4" />}
          label="Time in the system"
          value={usage ? formatDuration(usage.totalMs) : "never"}
        />
        <Stat
          icon={<LogIn className="size-4" />}
          label="Sessions"
          value={String(usage?.sessions ?? 0)}
        />
        <Stat
          icon={<FilePlus2 className="size-4" />}
          label="Created"
          value={String(counts.created)}
        />
        <Stat
          icon={<Trash2 className="size-4" />}
          label="Deleted"
          value={String(counts.deleted)}
          accent={counts.deleted > 0}
        />
      </div>

      {breakdown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {breakdown.map((b) => (
            <span
              key={b.action}
              className={cn(
                "rounded-lg px-2 py-1 text-label-md font-medium",
                auditTone(b.action) === "destructive" && "bg-destructive/10 text-destructive",
                auditTone(b.action) === "creative" && "bg-success/10 text-success",
                auditTone(b.action) === "neutral" && "bg-muted text-muted-foreground",
              )}
            >
              {b.action} {b.count}
            </span>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------- sessions ---- */}
      <section className="rounded-lg border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-headline-sm font-semibold text-foreground">Every visit</h2>
            <p className="mt-1 text-body-sm text-muted-foreground">
              Measured to the last heartbeat, so a window left open and forgotten stops counting
              rather than running on. Time with the app open is not time spent working in it.
            </p>
          </div>
          <ExportButton
            headers={[...SESSION_CSV_HEADERS]}
            rows={sessionCsvRows(theirSessions, who)}
            filename={`${slug(person.full_name)}-sessions.csv`}
            label="Export visits"
          />
        </div>
        {theirSessions.length === 0 ? (
          <EmptyState
            icon={LogIn}
            title="Never signed in"
            description="This account exists but has not opened the app since sessions started being recorded."
          />
        ) : (
          <ul className="divide-y divide-border">
            {theirSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-label-sm text-muted-foreground">
                    {when(s.started_at)}
                  </span>
                  {isSessionLive(s) && (
                    <span className="rounded bg-success/10 px-1.5 py-0.5 text-label-sm font-medium text-success">
                      still open
                    </span>
                  )}
                  {s.ended_at && (
                    <span className="text-label-sm text-muted-foreground">signed out</span>
                  )}
                </div>
                <span className="text-body-sm text-foreground">
                  {formatDuration(sessionDuration(s))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- trail ---- */}
      <section className="rounded-lg border border-border bg-card shadow-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-headline-sm font-semibold text-foreground">
            Everything they did
            <span className="ml-2 font-normal text-muted-foreground">{rows.length}</span>
          </h2>
          <p className="mt-1 text-body-sm text-muted-foreground">
            The whole record, not a recent slice. Nothing here can be edited or removed.
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={FilePlus2}
            title="Nothing recorded"
            description="They have not created, changed or deleted anything since the trail started."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-2.5"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 font-mono text-label-sm",
                      auditTone(row.action) === "destructive" && "bg-destructive/10 text-destructive",
                      auditTone(row.action) === "creative" && "bg-success/10 text-success",
                      auditTone(row.action) === "neutral" && "bg-muted text-muted-foreground",
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
            ))}
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
