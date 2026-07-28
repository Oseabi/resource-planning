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
} from "@/components/ui/dialog";
import { getSignedLetterUrl, deleteOemLetter } from "@/app/(app)/oem-letters/actions";

/** Fetches a short-lived signed URL, then opens the document in a new tab. */
export function LetterDownloadButton({
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
      const { url } = await getSignedLetterUrl(path);
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

export function DeleteLetterButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const { error } = await deleteOemLetter(id);
      if (error) {
        setError(error);
        return;
      }
      setOpen(false);
      router.push("/oem-letters");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this OEM letter?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{title}</span> and its stored document
              will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-body-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={isPending}>
              {isPending ? "Deleting..." : "Delete letter"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
