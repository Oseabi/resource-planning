"use client";

import { useState, useRef, useCallback } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CvReviewDialog } from "@/app/(app)/candidates/cv-review-dialog";
import type { ExtractionResult } from "@/lib/extraction/types";

const ACCEPTED = ".pdf,.docx";

export function CvUploadZone() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (selected: File) => {
    setError(null);
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", selected);
      const res = await fetch("/api/candidates/extract", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not process the document.");
      }
      const result: ExtractionResult = await res.json();
      setFile(selected);
      setExtraction(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-md border border-dashed bg-card px-6 py-10 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-accent text-primary">
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <UploadCloud className="size-5" />
          )}
        </div>
        <h3 className="mt-3 text-headline-sm font-semibold text-foreground">
          {busy ? "Reading document..." : "Drag & drop a CV here"}
        </h3>
        <p className="mx-auto mt-1 max-w-md text-body-sm text-muted-foreground">
          We&apos;ll automatically extract name, skills, certifications, and more to pre-fill the
          candidate profile. Text-based PDF and Word (.docx) supported.
        </p>
        <div className="mt-4">
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            Browse files
          </Button>
        </div>
        {error && <p className="mt-3 text-body-sm text-destructive">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {extraction && file && (
        <CvReviewDialog
          open={!!extraction}
          onOpenChange={(o) => {
            if (!o) {
              setExtraction(null);
              setFile(null);
            }
          }}
          extraction={extraction}
          file={file}
        />
      )}
    </>
  );
}
