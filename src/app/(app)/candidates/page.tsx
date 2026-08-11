import Link from "next/link";
import { Users, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { CandidatesFilters } from "@/app/(app)/candidates/candidates-filters";
import { CvUploadZone } from "@/app/(app)/candidates/cv-upload-zone";
import { StatusBadge, AvailabilityBadge, Chip } from "@/app/(app)/candidates/candidate-badges";

const PAGE_SIZE = 10;

function sanitizeTerm(term: string): string {
  return term.replace(/[,(){}"]/g, " ").trim();
}

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    role?: string;
    category?: string;
    status?: string;
    freeBy?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  let query = supabase
    .from("candidates")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (sp.status) query = query.eq("status", sp.status as "active" | "inactive" | "placed");
  if (sp.role) query = query.ilike("current_role", `%${sp.role}%`);
  if (sp.category) query = query.contains("resource_categories", [sp.category]);

  const term = sp.q ? sanitizeTerm(sp.q) : "";
  if (term) {
    // search_text is a generated column concatenating name/role/location + all
    // tag arrays, so a partial term (e.g. "Tekla") matches "Tekla Structures".
    query = query.ilike("search_text", `%${term}%`);
  }

  // "Free by" is a computed property, not a column: it depends on the latest
  // placement end date as well as the manual override. Rather than filter after
  // fetching, which would break the count and the paging, work out who is *not*
  // free by then and exclude those ids in SQL.
  const freeBy = /^\d{4}-\d{2}-\d{2}$/.test(sp.freeBy ?? "") ? sp.freeBy! : null;
  if (freeBy) {
    const { data: windows } = await supabase.from("placements").select("candidate_id, end_date");
    const stillCommitted = [
      ...new Set(
        (windows ?? [])
          // Open ended blocks outright; a date only blocks if it falls after.
          .filter((p) => p.end_date === null || p.end_date > freeBy)
          .map((p) => p.candidate_id),
      ),
    ];
    query = query.or(`available_from.is.null,available_from.lte.${freeBy}`);
    if (stillCommitted.length > 0) {
      query = query.not("id", "in", `(${stillCommitted.join(",")})`);
    }
  }

  const { data: candidates, count } = await query.range(from, from + PAGE_SIZE - 1);

  const [{ count: totalCount }, { count: availableCount }] = await Promise.all([
    supabase.from("candidates").select("id", { count: "exact", head: true }),
    supabase
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("availability", "available")
      .neq("status", "placed"),
  ]);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingTo = Math.min(from + PAGE_SIZE, total);
  const rows = candidates ?? [];

  const buildPageHref = (p: number) => {
    const next = new URLSearchParams();
    if (sp.q) next.set("q", sp.q);
    if (sp.role) next.set("role", sp.role);
    if (sp.category) next.set("category", sp.category);
    if (sp.status) next.set("status", sp.status);
    if (sp.freeBy) next.set("freeBy", sp.freeBy);
    next.set("page", String(p));
    return `/candidates?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">Candidate Intelligence</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            Manage and match resources.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatCard label="Total candidates" value={totalCount ?? 0} />
          <StatCard label="Available now" value={availableCount ?? 0} accent />
          <Button render={<Link href="/candidates/new" />} nativeButton={false}>
            <Plus className="size-4" />
            Add Candidate
          </Button>
        </div>
      </div>

      <CandidatesFilters />

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No candidates found"
            description="No candidates match your current filters. Adjust the filters above, or upload a CV below to add your first candidate."
          />
        ) : (
          <>
            {/* Desktop: dense data table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Role &amp; experience</TableHead>
                    <TableHead>Core skills</TableHead>
                    <TableHead>Certifications</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Availability</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer">
                      <TableCell>
                        <Link href={`/candidates/${c.id}`} className="block">
                          <div className="font-medium text-foreground">{c.full_name}</div>
                          <div className="text-body-sm text-muted-foreground">
                            {c.location ?? "-"}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/candidates/${c.id}`} className="block">
                          <div className="flex items-center gap-1.5 text-foreground">
                            {c.current_role ?? "-"}
                            {c.additional_roles.length > 0 && (
                              <span className="text-label-md text-muted-foreground">
                                +{c.additional_roles.length}
                              </span>
                            )}
                          </div>
                          <div className="text-body-sm text-muted-foreground">
                            {c.years_experience != null ? `${c.years_experience} yrs exp` : "-"}
                          </div>
                          {c.resource_categories.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {c.resource_categories.slice(0, 3).map((cat) => (
                                <CategoryChip key={cat}>{cat}</CategoryChip>
                              ))}
                              {c.resource_categories.length > 3 && (
                                <span className="text-label-md text-muted-foreground">+{c.resource_categories.length - 3}</span>
                              )}
                            </div>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const shown = [...c.technical_skills, ...c.skills];
                          return (
                            <div className="flex flex-wrap gap-1">
                              {shown.slice(0, 3).map((s) => (
                                <Chip key={s}>{s}</Chip>
                              ))}
                              {shown.length > 3 && (
                                <span className="text-label-md text-muted-foreground">+{shown.length - 3}</span>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {c.certifications.slice(0, 2).map((s) => (
                            <Chip key={s}>{s}</Chip>
                          ))}
                          {c.certifications.length > 2 && (
                            <span className="text-label-md text-muted-foreground">
                              +{c.certifications.length - 2}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        <AvailabilityBadge availability={c.availability} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((c) => {
                const shown = [...c.technical_skills, ...c.skills];
                return (
                  <li key={c.id}>
                    <Link href={`/candidates/${c.id}`} className="block px-4 py-3 transition-colors hover:bg-muted/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{c.full_name}</div>
                          <div className="truncate text-body-sm text-muted-foreground">
                            {c.current_role ?? "-"}
                            {c.years_experience != null ? ` · ${c.years_experience} yrs` : ""}
                            {c.location ? ` · ${c.location}` : ""}
                          </div>
                        </div>
                        <AvailabilityBadge availability={c.availability} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <StatusBadge status={c.status} />
                        {c.resource_categories.slice(0, 2).map((cat) => (
                          <CategoryChip key={cat}>{cat}</CategoryChip>
                        ))}
                        {shown.slice(0, 3).map((s) => (
                          <Chip key={s}>{s}</Chip>
                        ))}
                        {shown.length > 3 && (
                          <span className="text-label-md text-muted-foreground">+{shown.length - 3}</span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <p className="text-body-sm text-muted-foreground">
            {total === 0
              ? "No candidates"
              : `Showing ${from + 1}–${showingTo} of ${total} candidate${total === 1 ? "" : "s"}`}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              render={page <= 1 ? undefined : <Link href={buildPageHref(page - 1)} />}
              nativeButton={page <= 1}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              render={page >= totalPages ? undefined : <Link href={buildPageHref(page + 1)} />}
              nativeButton={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-headline-sm font-semibold text-foreground">Add a candidate</h2>
        <CvUploadZone />
      </div>
    </div>
  );
}

function CategoryChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-lg bg-primary/10 px-2 py-0.5 text-label-md font-medium text-primary">
      {children}
    </span>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="min-w-36 rounded-lg border border-border bg-card shadow-card px-4 py-3">
      <div className="text-label-sm uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={accent ? "text-display font-semibold text-success" : "text-display font-semibold text-foreground"}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
