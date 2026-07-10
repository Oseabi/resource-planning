"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
import { deleteTender } from "@/app/(app)/tenders/actions";

export function DeleteTenderButton({
  tenderId,
  tenderTitle,
}: {
  tenderId: string;
  tenderTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const { error } = await deleteTender(tenderId);
      if (error) {
        setError(error);
      } else {
        setOpen(false);
        router.push("/tenders");
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
          <DialogTitle>Delete tender</DialogTitle>
          <DialogDescription>
            Permanently delete <span className="font-medium text-foreground">{tenderTitle}</span>,
            its match results, and its RFQ document? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-body-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? "Deleting..." : "Delete tender"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
