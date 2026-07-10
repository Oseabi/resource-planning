import Link from "next/link";
import { Plus, UserSquare2 } from "lucide-react";
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
import { RequirementStatusBadge } from "@/app/(app)/job-requirements/requirement-badges";

export default async function JobRequirementsPage() {
  const supabase = await createClient();

  const { data: requirements } = await supabase
    .from("job_requirements")
    .select("id, title, client, required_role, status, created_at")
    .order("created_at", { ascending: false });

  const rows = requirements ?? [];

  // Match counts per requirement (single query, grouped in app).
  const ids = rows.map((r) => r.id);
  const countByReq = new Map<string, number>();
  if (ids.length) {
    const { data: matches } = await supabase
      .from("matches")
      .select("match_target_id")
      .eq("match_target_type", "job_requirement")
      .in("match_target_id", ids);
    for (const m of matches ?? []) {
      countByReq.set(m.match_target_id, (countByReq.get(m.match_target_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">Job Requirements</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            Define roles and match candidates against them.
          </p>
        </div>
        <Button render={<Link href="/job-requirements/new" />} nativeButton={false}>
          <Plus className="size-4" />
          Create Requirement
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {rows.length === 0 ? (
          <EmptyState
            icon={UserSquare2}
            title="No job requirements yet"
            description="Define a role with its required skills and experience, then match candidates against it automatically."
            action={
              <Button render={<Link href="/job-requirements/new" />} nativeButton={false}>
                <Plus className="size-4" />
                Create Requirement
              </Button>
            }
          />
        ) : (
          <>
            {/* Desktop: data table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Required role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Matches</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link href={`/job-requirements/${r.id}`} className="font-medium text-foreground hover:text-primary">
                          {r.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.client ?? "—"}</TableCell>
                      <TableCell className="text-foreground">{r.required_role ?? "—"}</TableCell>
                      <TableCell>
                        <RequirementStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right text-foreground">
                        {countByReq.get(r.id) ?? 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/job-requirements/${r.id}`} className="block px-4 py-3 transition-colors hover:bg-muted/50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{r.title}</div>
                        <div className="truncate text-body-sm text-muted-foreground">
                          {r.required_role ?? "—"}
                          {r.client ? ` · ${r.client}` : ""}
                        </div>
                      </div>
                      <RequirementStatusBadge status={r.status} />
                    </div>
                    <div className="mt-2 text-body-sm text-muted-foreground">
                      {countByReq.get(r.id) ?? 0} match{(countByReq.get(r.id) ?? 0) === 1 ? "" : "es"}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
