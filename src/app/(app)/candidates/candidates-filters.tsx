"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { VOCABULARY } from "@/lib/vocabulary";
import { CATEGORY_NAMES } from "@/lib/resource-categories";
import type { DepartmentBrand } from "@/lib/departments";
import { DepartmentDot } from "@/components/departments/department-chip";

const STATUS_LABELS: Record<string, string> = {
  all: "Any status",
  active: "Active",
  inactive: "Inactive",
  placed: "Placed",
};

export function CandidatesFilters({
  departments = [],
  defaultDepartmentId = null,
}: {
  departments?: DepartmentBrand[];
  /** What the list shows when the address names no department: the person's own. */
  defaultDepartmentId?: string | null;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");

  // Debounce the free-text search into the URL.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => update("q", q), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    // "all" is a real choice for the department, since leaving it out means
    // the person's own; for everything else it means no filter.
    if (value && (value !== "all" || key === "department")) next.set(key, value);
    else next.delete(key);
    next.delete("page"); // reset pagination on any filter change
    router.push(`${pathname}?${next.toString()}`);
  }

  const departmentValue = params.get("department") ?? defaultDepartmentId ?? "all";
  const departmentLabel = (v: string) =>
    v === "none" ? "No department yet" : (departments.find((d) => d.id === v)?.name ?? "All departments");

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, role, location, or skills..."
          className="pl-9"
        />
      </div>

      {departments.length > 0 && (
        <Select value={departmentValue} onValueChange={(v) => update("department", v)}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Department">
            <SelectValue placeholder="All departments">
              {(v) => (
                <span className="inline-flex items-center gap-2">
                  <DepartmentDot colour={departments.find((d) => d.id === String(v))?.colour ?? null} />
                  {departmentLabel(String(v))}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                <span className="inline-flex items-center gap-2">
                  <DepartmentDot colour={d.colour} />
                  {d.name}
                </span>
              </SelectItem>
            ))}
            <SelectItem value="none">No department yet</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Select
        value={params.get("role") ?? "all"}
        onValueChange={(v) => update("role", v)}
      >
        <SelectTrigger className="w-full sm:w-48">
          <SelectValue placeholder="All roles">
            {(v) => (!v || v === "all" ? "All roles" : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All roles</SelectItem>
          {VOCABULARY.roles.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={params.get("category") ?? "all"}
        onValueChange={(v) => update("category", v)}
      >
        <SelectTrigger className="w-full sm:w-48">
          <SelectValue placeholder="All categories">
            {(v) => (!v || v === "all" ? "All categories" : String(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {CATEGORY_NAMES.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={params.get("status") ?? "all"}
        onValueChange={(v) => update("status", v)}
      >
        <SelectTrigger className="w-full sm:w-40">
          <SelectValue placeholder="Any status">
            {(v) => STATUS_LABELS[String(v)] ?? "Any status"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
          <SelectItem value="placed">Placed</SelectItem>
        </SelectContent>
      </Select>

      {/* A date rather than a preset list, because the date that matters is
          whenever the bid actually starts. */}
      <div className="flex items-center gap-2">
        <label htmlFor="free-by" className="shrink-0 text-body-sm text-muted-foreground">
          Free by
        </label>
        <Input
          id="free-by"
          type="date"
          className="w-full sm:w-40"
          value={params.get("freeBy") ?? ""}
          onChange={(e) => update("freeBy", e.target.value || null)}
        />
      </div>
    </div>
  );
}
