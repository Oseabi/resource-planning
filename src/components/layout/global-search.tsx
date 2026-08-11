"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  FileText,
  UserSquare2,
  ShieldCheck,
  Plus,
  LayoutGrid,
  BarChart3,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { globalSearch, type SearchHit, type SearchHitType } from "@/app/(app)/search-action";

/** Long enough that a fast typist issues one query per word, not one per letter. */
const DEBOUNCE_MS = 200;

/** Mirrors MIN_QUERY_LENGTH in the action; below this the server returns nothing. */
const MIN_QUERY_LENGTH = 2;

const GROUPS: { type: SearchHitType; heading: string; icon: React.ElementType }[] = [
  { type: "candidate", heading: "Candidates", icon: Users },
  { type: "tender", heading: "Tenders", icon: FileText },
  { type: "job_requirement", heading: "Job Requirements", icon: UserSquare2 },
  { type: "oem_letter", heading: "OEM Letters", icon: ShieldCheck },
];

const QUICK_ACTIONS: { label: string; href: string; icon: React.ElementType }[] = [
  { label: "New candidate", href: "/candidates/new", icon: Plus },
  { label: "New tender", href: "/tenders/new", icon: Plus },
  { label: "New job requirement", href: "/job-requirements/new", icon: Plus },
  { label: "Add OEM letter", href: "/oem-letters/new", icon: Plus },
];

const JUMP_TO: { label: string; href: string; icon: React.ElementType }[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutGrid },
  { label: "Candidates", href: "/candidates", icon: Users },
  { label: "Tenders", href: "/tenders", icon: FileText },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
];

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  // Results carry the query they were fetched for. That makes "are these results
  // current" a derived question rather than another piece of state to keep in
  // sync, which kills the stale-response race and means nothing has to be
  // cleared synchronously when the query changes.
  const [result, setResult] = React.useState<{ query: string; hits: SearchHit[] }>({
    query: "",
    hits: [],
  });

  const trimmed = query.trim();
  const searching = trimmed.length >= MIN_QUERY_LENGTH;
  const current = result.query === trimmed;
  const hits = current ? result.hits : [];
  const loading = searching && !current;

  // Cmd+K on macOS, Ctrl+K elsewhere.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Debounced fetch. The cancelled flag stops an in-flight request from landing
  // after the user has moved on; storing the query alongside the hits handles
  // ordering, so a slow early response can never overwrite a fast later one.
  React.useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      let hits: SearchHit[] = [];
      try {
        hits = await globalSearch(trimmed);
      } catch {
        // Swallow and record an empty result. Leaving it unset would strand the
        // palette on "Searching..." forever.
      }
      if (!cancelled) setResult({ query: trimmed, hits });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      {/* Replaces a search box that was decorative. Rendered as a button so it
          reads to assistive tech as the thing it is: opens a dialog. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-input bg-background py-2 pl-3 pr-2 text-left text-body-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
      >
        <Search className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search candidates, bids, letters...</span>
        <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-label-sm text-muted-foreground sm:inline-block">
          Ctrl K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search candidates, tenders, job requirements and OEM letters."
      >
        {/* CommandDialog here does not include the Command root itself, unlike
            the usual shadcn version, so it has to be supplied or cmdk has no
            context to work in.

            shouldFilter off: the server already decided what matches. Leaving
            cmdk's own fuzzy filter on would re-filter those results against the
            raw query and hide legitimate hits, e.g. a candidate matched on a
            skill that never appears in their name. */}
        <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search candidates, bids, letters..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {searching && !loading && hits.length === 0 && (
            <CommandEmpty>No results for &ldquo;{query}&rdquo;.</CommandEmpty>
          )}

          {searching && loading && hits.length === 0 && (
            <div className="py-6 text-center text-body-sm text-muted-foreground">Searching...</div>
          )}

          {searching &&
            GROUPS.map(({ type, heading, icon: Icon }) => {
              const group = hits.filter((h) => h.type === type);
              if (group.length === 0) return null;
              return (
                <CommandGroup key={type} heading={heading}>
                  {group.map((hit) => (
                    <CommandItem
                      key={`${type}-${hit.id}`}
                      value={`${type}-${hit.id}`}
                      onSelect={() => go(hit.href)}
                    >
                      <Icon className="text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-foreground">{hit.title}</span>
                        {hit.subtitle && (
                          <span className="ml-2 text-muted-foreground">{hit.subtitle}</span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}

          {!searching && (
            <>
              <CommandGroup heading="Create">
                {QUICK_ACTIONS.map(({ label, href, icon: Icon }) => (
                  <CommandItem key={href} value={label} onSelect={() => go(href)}>
                    <Icon className="text-muted-foreground" />
                    <span>{label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Go to">
                {JUMP_TO.map(({ label, href, icon: Icon }) => (
                  <CommandItem key={href} value={`go ${label}`} onSelect={() => go(href)}>
                    <Icon className="text-muted-foreground" />
                    <span>{label}</span>
                    <CommandShortcut>{href}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
