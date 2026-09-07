import Link from "next/link";
import { Plus, FileCheck2, Mail, Phone, CalendarCheck, Banknote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { formatDate } from "@/lib/availability";
import { isContactable } from "@/lib/reference-letters";
import { cn } from "@/lib/utils";

function formatValue(value: number | null): string {
  if (value == null) return "-";
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value}`;
}

/**
 * The reference letters the business can put into a bid.
 *
 * Ordered by when the work finished, newest first, because that is the axis
 * tenders judge them on: "three references for similar work in the last five
 * years" is the usual wording, and an old letter is simply not eligible.
 */
export default async function ReferenceLettersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reference_letters")
    .select("*")
    .order("work_completed_on", { ascending: false, nullsFirst: false });

  const letters = data ?? [];
  const contactable = letters.filter(isContactable).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">Reference letters</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            Letters from past clients, used to answer a tender&apos;s reference requirement.
          </p>
        </div>
        <Button render={<Link href="/reference-letters/new" />} nativeButton={false}>
          <Plus className="size-4" />
          Add letter
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Letters on file" value={String(letters.length)} />
        {/* The number that actually answers a requirement, since tenders ask
            for contactable references. */}
        <StatCard label="Contactable" value={String(contactable)} />
        <StatCard
          label="No contact details"
          value={String(letters.length - contactable)}
          accent={letters.length - contactable > 0}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {letters.length === 0 ? (
          <EmptyState
            icon={FileCheck2}
            title="No reference letters yet"
            description="Tenders routinely ask for three or more contactable references. Add the letters you already hold so a bid can be checked against them."
            action={
              <Button render={<Link href="/reference-letters/new" />} nativeButton={false}>
                <Plus className="size-4" />
                Add letter
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {letters.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/reference-letters/${l.id}`}
                  className="block px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{l.client}</div>
                      <div className="truncate text-body-sm text-muted-foreground">
                        {l.project_title}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-lg px-2 py-0.5 text-label-md font-medium",
                        isContactable(l)
                          ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {isContactable(l) ? "Contactable" : "No contact"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted-foreground">
                    {l.work_completed_on && (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarCheck className="size-3.5" />
                        Completed {formatDate(l.work_completed_on)}
                      </span>
                    )}
                    {l.contract_value != null && (
                      <span className="inline-flex items-center gap-1.5">
                        <Banknote className="size-3.5" />
                        {formatValue(l.contract_value)}
                      </span>
                    )}
                    {l.contact_email && (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="size-3.5" />
                        {l.contact_email}
                      </span>
                    )}
                    {l.contact_phone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="size-3.5" />
                        {l.contact_phone}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</div>
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
