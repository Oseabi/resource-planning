"use client";

import { useState } from "react";
import { FileDown, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Download a candidate as a TiPP Focus CV.
 *
 * When the record cannot fill every row the template has, the gaps are listed
 * first. Warning here rather than after the download is the point: this is the
 * last moment the person can still fix it before the document reaches a bid.
 */
export function TippCvButton({
  candidateId,
  candidateName,
  missingFields,
}: {
  candidateId: string;
  candidateName: string;
  missingFields: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/candidates/tipp-cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not build the CV.");
        return;
      }

      // A blob URL rather than a direct link, because the route is a POST and
      // the browser cannot navigate to it.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TippFocus - ${candidateName}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => (missingFields.length > 0 ? setConfirming(true) : download())}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
        TiPP Focus CV
      </Button>

      {error && !confirming && <p className="text-body-sm text-destructive">{error}</p>}

      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Some template fields are empty</DialogTitle>
            <DialogDescription>
              The CV will still generate. These rows will be blank in the document, so it is worth
              filling them in on {candidateName} first if this is going out with a bid.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-1 py-1">
            {missingFields.map((field) => (
              <li key={field} className="flex items-center gap-2 text-body-sm text-foreground">
                <AlertTriangle className="size-4 shrink-0 text-strong-match" />
                {field}
              </li>
            ))}
          </ul>

          {error && <p className="text-body-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Go back and fill them in
            </Button>
            <Button onClick={download} disabled={busy}>
              {busy ? "Building..." : "Download anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
