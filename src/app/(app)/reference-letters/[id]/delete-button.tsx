"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";
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
import { deleteReferenceLetter } from "@/app/(app)/reference-letters/actions";
import { fileRoute } from "@/lib/candidate-files";

/** Opens the letter through the app's file route, straight from the click. */
export function ReferenceLetterDownloadButton({ letterId, filename }: { letterId: string; filename: string | null }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.open(fileRoute("reference-letter", letterId), "_blank", "noopener,noreferrer")}
    >
      <Download className="size-4" />
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
