import Link from "next/link";
import { Plus, FileCheck2, Mail, Phone, CalendarCheck, Banknote, Folder } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { formatDate } from "@/lib/availability";
import { isContactable, groupByFolder, UNFILED } from "@/lib/reference-letters";
import { KindChip } from "@/app/(app)/reference-letters/kind-chip";
import { cn } from "@/lib/utils";

function formatValue(value: number | null): string {
  if (value == null) return "-";
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value}`;
}

/** An anchor a folder chip can jump to. */
function folderAnchor(folder: string | null): string {
  return `folder-${(folder ?? UNFILED).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/**
 * The reference letters the business can put into a bid, filed by folder.
 *
 * Folders are the practice areas the bid team keeps its letters under, which
 * is how a bid writer looks for one: "the EA references". Within a folder
 * the letters are ordered by when the work finished, newest first, because
 * that is the axis tenders judge them on: "three references for similar
 * work in the last five years" is the usual wording, and an old letter is
 * simply not eligible. Each letter carries what it is, since an award or
 * confirmation letter sits on file beside the references without counting
 * as one.
 */
export default async function ReferenceLettersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reference_letters")
    .select("*")
    .order("work_completed_on", { ascending: false, nullsFirst: false });

  const letters = data ?? [];
  const references = letters.filter((l) => l.kind === "reference");
  const contactable = references.filter(isContactable).length;
  const supporting = letters.length - references.length;
  const groups = groupByFolder(letters);

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Reference letters" value={String(references.length)} />
        {/* The number that actually answers a requirement, since tenders ask
            for contactable references. */}
        <StatCard label="Contactable" value={String(contactable)} />
        <StatCard
          label="No contact details"
          value={String(references.length - contactable)}
          accent={references.length - contactable > 0}
        />
        {/* Kept beside the references and never counted as one. */}
        <StatCard label="Award and confirmation letters" value={String(supporting)} />
      </div>

      {letters.length === 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
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
        </div>
      ) : (
        <>
          {/* One chip per folder, so a long list opens on the folder wanted. */}
          {groups.length > 1 && (
            <nav aria-label="Folders" className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <a
                  key={g.folder ?? UNFILED}
                  href={`#${folderAnchor(g.folder)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-body-sm text-foreground transition-colors hover:bg-muted/50"
                >
                  <Folder className="size-3.5 text-muted-foreground" />
                  {g.folder ?? UNFILED}
                  <span className="text-muted-foreground">{g.letters.length}</span>
                </a>
              ))}
            </nav>
          )}

          {groups.map((g) => (
            <section
              key={g.folder ?? UNFILED}
              id={folderAnchor(g.folder)}
              className="scroll-mt-4 overflow-hidden rounded-lg border border-border bg-card shadow-card"
            >
              <h2 className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-label-md font-semibold text-foreground">
                <Folder className="size-4 text-muted-foreground" />
                {g.folder ?? UNFILED}
                <span className="font-normal text-muted-foreground">
                  {g.letters.length === 1 ? "1 letter" : `${g.letters.length} letters`}
                </span>
              </h2>
              <ul className="divide-y divide-border">
                {g.letters.map((l) => (
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
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <KindChip kind={l.kind} />
                          <span
                            className={cn(
                              "rounded-lg px-2 py-0.5 text-label-md font-medium",
                              isContactable(l)
                                ? "bg-success/10 text-success"
                                : "bg-destructive/10 text-destructive",
                            )}
                          >
                            {isContactable(l) ? "Contactable" : "No contact"}
                          </span>
                        </div>
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
            </section>
          ))}
        </>
      )}
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
