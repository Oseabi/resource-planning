"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  deleteReferenceLetter,
  getSignedReferenceUrl,
} from "@/app/(app)/reference-letters/actions";

/**
 * Fetches a short-lived signed URL, then opens the letter in a new tab.
 *
 * Its own button rather than the candidates' CvDownloadButton, which this page
 * used to borrow: that one signs against the cvs bucket and these letters live
 * in oem-letters, so every download here silently did nothing. One small button
 * per module, each knowing its own signer, is how the rest of the app does it.
 */
export function ReferenceLetterDownloadButton({
  path,
  filename,
}: {
  path: string;
  filename: string | null;
}) {
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      const { url } = await getSignedReferenceUrl(path);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={open} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      {filename ?? "Download letter"}
    </Button>
  );
}

export function DeleteReferenceLetterButton({
  letterId,
  letterTitle,
}: {
  letterId: string;
  letterTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const { error } = await deleteReferenceLetter(letterId);
      if (error) {
        setError(error);
      } else {
        setOpen(false);
        router.push("/reference-letters");
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        <Trash2 className="size-4" />
        Delete
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete reference letter</DialogTitle>
          <DialogDescription>
            Permanently delete the reference for{" "}
            <span className="font-medium text-foreground">{letterTitle}</span> and its signed
            document? Every tender counting it toward a reference requirement will drop by one.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-body-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? "Deleting..." : "Delete letter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
