"use client";

import { useState } from "react";
import { FileDown, FileText, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type CvFormat = "pdf" | "docx";

/**
 * Download a candidate as a TiPP Focus CV.
 *
 * The PDF is the document as the team issues it and is what goes to a
 * client; the Word file is the same content on the team's template, for
 * anyone who wants to edit it first. When the record cannot fill every row
 * the template has, the gaps are listed first. Warning here rather than
 * after the download is the point: this is the last moment the person can
 * still fix it before the document reaches a bid.
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
  const [busy, setBusy] = useState<CvFormat | null>(null);
  const [confirming, setConfirming] = useState<CvFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: CvFormat) {
    setBusy(format);
    setError(null);
    try {
      const res = await fetch("/api/candidates/tipp-cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, format }),
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
      a.download = `TippFocus - ${candidateName}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setConfirming(null);
    } finally {
      setBusy(null);
    }
  }

  function start(format: CvFormat) {
    if (missingFields.length > 0) setConfirming(format);
    else void download(format);
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => start("pdf")}>
        {busy === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
        TiPP Focus CV
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => start("docx")}
        title="The same CV as a Word document, for editing"
      >
        {busy === "docx" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
        Word
      </Button>

      {error && !confirming && <p className="text-body-sm text-destructive">{error}</p>}

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
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
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy !== null}>
              Go back and fill them in
            </Button>
            <Button onClick={() => confirming && download(confirming)} disabled={busy !== null}>
              {busy ? "Building..." : "Download anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
