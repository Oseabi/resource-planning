"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Sparkles, X, Send, Loader2, RotateCcw, Copy, Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvailabilityBadge } from "@/app/(app)/candidates/candidate-badges";
import { findTalent, type TalentReply } from "@/app/(app)/talent-search-action";
import type { TalentQuery } from "@/lib/talent-search/query";
import type { TalentResult } from "@/lib/talent-search/rank";
import { cn } from "@/lib/utils";

type Message = { from: "you"; text: string } | { from: "finder"; reply: TalentReply };

const EXAMPLES = [
  "3 software developers with MB-500",
  "5 business analysts with 8+ years in Gauteng",
  "2 Java developers available now",
  "4 project managers with PMP",
];

/**
 * The candidate finder: a chat panel on every page.
 *
 * Each answer carries the criteria it was read as, and the next message is
 * sent with them, so "make it 5" or "only in Cape Town" refines the last
 * search. The conversation lives in the layout, so it survives moving
 * between pages; "New search" forgets it.
 */
export function TalentChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState<TalentQuery | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setDraft("");
    setMessages((m) => [...m, { from: "you", text: message }]);
    startTransition(async () => {
      try {
        const reply = await findTalent(message, query);
        setQuery(reply.query);
        setMessages((m) => [...m, { from: "finder", reply }]);
      } catch {
        setMessages((m) => [
          ...m,
          { from: "finder", reply: { query, reading: null, text: "Something went wrong. Try again.", fits: [], close: [], readBy: null } },
        ]);
      }
    });
  }

  function reset() {
    setMessages([]);
    setQuery(null);
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-body-sm font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90"
        >
          <Sparkles className="size-4" />
          Find candidates
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Candidate finder"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          className="fixed inset-0 z-50 flex flex-col border-border bg-card shadow-xl sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(640px,calc(100vh-2.5rem))] sm:w-[420px] sm:rounded-xl sm:border"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h2 className="whitespace-nowrap text-body-md font-semibold text-foreground">Candidate finder</h2>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
                  <RotateCcw className="size-3.5" />
                  New search
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close the candidate finder">
                <X className="size-4" />
              </Button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-body-sm text-muted-foreground">
                  Say who you need: how many, the role, and any certificates, skills, years, place or availability.
                  Then refine: &ldquo;make it 5&rdquo;, &ldquo;only in Cape Town&rdquo;, &ldquo;also with AZ-900&rdquo;.
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => send(e)}
                      className="rounded-full border border-border px-3 py-1 text-label-md text-foreground transition-colors hover:bg-accent"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.from === "you" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-body-sm text-primary-foreground">{m.text}</p>
                </div>
              ) : (
                <FinderReply key={i} reply={m.reply} />
              ),
            )}

            {pending && (
              <div className="flex items-center gap-2 text-body-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Searching the pool...
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              maxLength={600}
              placeholder={query ? "Refine, or ask for someone else..." : "e.g. 3 software developers with MB-500"}
              aria-label="Who are you looking for"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-body-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <Button type="submit" size="icon" disabled={pending || !draft.trim()} aria-label="Search">
              <Send className="size-4" />
            </Button>
          </form>
        </section>
      )}
    </>
  );
}

function FinderReply({ reply }: { reply: TalentReply }) {
  const [copied, setCopied] = useState(false);
  const all = [...reply.fits, ...reply.close];

  async function copy() {
    const lines = all.map((r) =>
      [r.name, r.matchedRole ?? r.role ?? "", r.years != null ? `${r.years} yrs` : "", r.certificates.map((c) => c.wanted).join(", ")]
        .filter(Boolean)
        .join(" | "),
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (no focus or no permission); nothing to undo.
    }
  }

  return (
    <div className="space-y-2">
      {reply.reading && (
        <p className="text-label-md text-muted-foreground">
          Read as: <span className="font-medium text-foreground">{reply.reading}</span>
        </p>
      )}
      <p className="text-body-sm text-foreground">{reply.text}</p>
      {reply.fits.length > 0 && (
        <ul className="space-y-2">
          {reply.fits.map((r) => (
            <ResultCard key={r.id} result={r} />
          ))}
        </ul>
      )}
      {reply.close.length > 0 && (
        <>
          {reply.fits.length > 0 && <p className="pt-1 text-label-md font-medium text-muted-foreground">Closest after them</p>}
          <ul className="space-y-2">
            {reply.close.map((r) => (
              <ResultCard key={r.id} result={r} near />
            ))}
          </ul>
        </>
      )}
      {all.length > 0 && (
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy list"}
        </Button>
      )}
    </div>
  );
}

function ResultCard({ result: r, near = false }: { result: TalentResult; near?: boolean }) {
  return (
    <li className={cn("rounded-lg border p-3", near ? "border-dashed border-border" : "border-border bg-background")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/candidates/${r.id}`} className="block truncate text-body-sm font-medium text-foreground hover:text-primary">
            {r.name}
          </Link>
          <p className="truncate text-label-md text-muted-foreground">
            {r.role ?? "No role on file"}
            {r.matchedRole ? ` (also ${r.matchedRole})` : ""}
          </p>
          <p className="text-label-md text-muted-foreground">
            {[r.years != null ? `${r.years} yrs` : null, r.location].filter(Boolean).join(" · ") || "No experience or location on file"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-label-md font-semibold text-primary">{r.score}%</span>
          <AvailabilityBadge availability={r.availability} />
        </div>
      </div>
      {(r.certificates.length > 0 || r.skills.length > 0) && (
        <ul className="mt-2 space-y-0.5">
          {[...r.certificates, ...r.skills].map((c) => (
            <li key={c.wanted} className="text-label-md text-foreground">
              <Check className="mr-1 inline size-3 text-primary" />
              <span className="font-medium">{c.wanted}</span>
              {c.via.toLowerCase() !== c.wanted.toLowerCase() && <span className="text-muted-foreground">: {c.via}</span>}
            </li>
          ))}
        </ul>
      )}
      {r.unchecked.length > 0 && <p className="mt-1 text-label-md text-muted-foreground">{r.unchecked.join("; ")}</p>}
      {r.missing.length > 0 && (
        <p className="mt-2 flex items-start gap-1 text-label-md text-strong-match">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          <span>Lacks: {r.missing.join("; ")}</span>
        </p>
      )}
    </li>
  );
}
