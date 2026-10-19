"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/availability";
import { groupByKind } from "@/lib/candidate-attachments";
import {
  deleteCandidateAttachment,
  getSignedAttachmentUrl,
} from "@/app/(app)/candidates/attachment-actions";
import type { Database } from "@/lib/supabase/database.types";

type Attachment = Database["public"]["Tables"]["candidate_attachments"]["Row"];

/**
 * The documents on a person's file, under their headings.
 *
 * A client component because both row controls are interactive: a download
 * fetches a short-lived signed URL first, and a removal needs confirming. One
 * confirmation dialog serves the whole list rather than one per row.
 */
export function CandidateAttachments({
  attachments,
  viewerId,
  isAdmin,
}: {
  attachments: Attachment[];
  /** Whose profile this is being read by. Decides who sees a remove control. */
  viewerId: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startTransition] = useTransition();

  async function open(attachment: Attachment) {
    setBusyId(attachment.id);
    try {
      const { url } = await getSignedAttachmentUrl(attachment.file_path);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusyId(null);
    }
  }

  function confirmRemove() {
    if (!pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCandidateAttachment(pending.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPending(null);
      router.refresh();
    });
  }

  if (attachments.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        No other documents yet. Certificates, qualifications, an ID copy or a signed contract go
        here.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {groupByKind(attachments).map((group) => (
          <div key={group.kind}>
            <h3 className="mb-1.5 text-label-sm font-medium text-muted-foreground">
              {group.heading}
            </h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {group.items.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{a.title}</div>
                    <div className="truncate text-body-sm text-muted-foreground">
                      {a.original_filename}
                      {" · "}
                      {formatDate(a.created_at.slice(0, 10))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open(a)}
                      disabled={busyId === a.id}
                      aria-label={`Download ${a.title}`}
                    >
                      {busyId === a.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Download className="size-4" />
                      )}
                      Download
                    </Button>
                    {/* Mirrors the delete policy. Cosmetic: the row count in
                        the action is what actually decides. */}
                    {(isAdmin || (viewerId !== null && a.created_by === viewerId)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setPending(a);
                        }}
                        aria-label={`Remove ${a.title}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Dialog open={pending !== null} onOpenChange={(next) => !next && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this document?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{pending?.title}</span> and its stored
              file will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-body-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPending(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemove} disabled={isDeleting}>
              {isDeleting ? "Removing..." : "Remove document"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
