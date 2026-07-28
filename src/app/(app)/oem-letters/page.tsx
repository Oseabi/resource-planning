import Link from "next/link";
import { Folder, Plus, ShieldCheck, AlertTriangle, FileText, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
import { ExpiryBadge } from "@/app/(app)/oem-letters/expiry-badge";
import { buildFolders, expiryStatus } from "@/lib/oem-letters";
import { cn } from "@/lib/utils";

type GroupBy = "vendor" | "category";

export default async function OemLettersPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; folder?: string }>;
}) {
  const sp = await searchParams;
  const groupBy: GroupBy = sp.by === "category" ? "category" : "vendor";
  const openFolder = sp.folder?.trim() || null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("oem_letters")
    .select("*")
    .order("expiry_date", { ascending: true, nullsFirst: false });

  const letters = data ?? [];
  const keyOf = (l: { oem_vendor: string; categories: string[] }) =>
    groupBy === "vendor" ? [l.oem_vendor] : l.categories;

  const folders = buildFolders(
    letters,
    (l) => keyOf(l as (typeof letters)[number]),
    new Date(),
  );

  const visible = openFolder
    ? letters.filter((l) => keyOf(l).some((k) => k.trim() === openFolder))
    : letters;

  const expired = letters.filter((l) => expiryStatus(l.expiry_date) === "expired").length;
  const expiringSoon = letters.filter((l) => expiryStatus(l.expiry_date) === "expiring_soon").length;
  const uncategorised = letters.filter((l) => l.categories.length === 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold text-foreground">OEM Letters</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            Manufacturer authorisation letters, filed by vendor and practice area.
          </p>
        </div>
        <Button render={<Link href="/oem-letters/new" />} nativeButton={false}>
          <Plus className="size-4" />
          Add Letter
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat icon={<ShieldCheck className="size-4" />} label="Letters on file" value={letters.length} />
        <Stat
          icon={<AlertTriangle className="size-4" />}
          label="Expiring soon"
          value={expiringSoon}
          tone={expiringSoon > 0 ? "warn" : undefined}
        />
        <Stat
          icon={<AlertTriangle className="size-4" />}
          label="Expired"
          value={expired}
          tone={expired > 0 ? "bad" : undefined}
        />
      </div>

      {/* Group-by switch */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label-sm uppercase tracking-wide text-muted-foreground">
          Browse by
        </span>
        <GroupTab href="/oem-letters?by=vendor" active={groupBy === "vendor"}>
          OEM / vendor
        </GroupTab>
        <GroupTab href="/oem-letters?by=category" active={groupBy === "category"}>
          Practice area
        </GroupTab>
        {groupBy === "category" && uncategorised > 0 && (
          <span className="text-body-sm text-muted-foreground">
            {uncategorised} letter{uncategorised === 1 ? "" : "s"} with no practice area
          </span>
        )}
      </div>

      {openFolder ? (
        <div>
          <Link
            href={`/oem-letters?by=${groupBy}`}
            className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All folders
          </Link>
          <h2 className="mt-2 flex items-center gap-2 text-headline-sm font-semibold text-foreground">
            <Folder className="size-4 text-primary" />
            {openFolder}
            <span className="text-body-sm font-normal text-muted-foreground">
              ({visible.length})
            </span>
          </h2>
        </div>
      ) : folders.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {folders.map((f) => (
            <Link
              key={f.name}
              href={`/oem-letters?by=${groupBy}&folder=${encodeURIComponent(f.name)}`}
              className="group rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <div className="flex items-start justify-between gap-2">
                <Folder className="size-5 text-primary" />
                <span className="text-label-md text-muted-foreground">{f.count}</span>
              </div>
              <div className="mt-2 truncate font-medium text-foreground group-hover:text-primary">
                {f.name}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {f.expired > 0 && (
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-label-sm text-destructive">
                    {f.expired} expired
                  </span>
                )}
                {f.expiringSoon > 0 && (
                  <span className="rounded bg-strong-match/10 px-1.5 py-0.5 text-label-sm text-strong-match">
                    {f.expiringSoon} expiring
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      {/* Letters */}
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        {visible.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={openFolder ? "No letters in this folder" : "No OEM letters yet"}
            description={
              openFolder
                ? "Nothing filed here yet. Add a letter and tag it with this vendor or practice area."
                : "Upload your first manufacturer authorisation letter to start tracking coverage and expiry."
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/oem-letters/${l.id}`}
                  className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{l.title}</div>
                    <div className="truncate text-body-sm text-muted-foreground">
                      {l.oem_vendor}
                      {l.reference_number ? ` · ${l.reference_number}` : ""}
                      {l.expiry_date ? ` · expires ${l.expiry_date}` : ""}
                    </div>
                    {l.categories.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.categories.map((c) => (
                          <span
                            key={c}
                            className="rounded-lg bg-accent px-2 py-0.5 text-label-md text-accent-foreground"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {l.file_path && <FileText className="size-4 text-muted-foreground" />}
                    <ExpiryBadge expiryDate={l.expiry_date} />
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

function GroupTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 text-label-sm uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-display font-semibold",
          tone === "bad" ? "text-destructive" : tone === "warn" ? "text-strong-match" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
