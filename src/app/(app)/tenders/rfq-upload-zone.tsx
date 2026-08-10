"use client";

import { useState, useRef, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ScanText, Loader2, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TenderFields, type TenderExtractedFlags } from "@/app/(app)/tenders/tender-fields";
import { createTender, type TenderFormFields } from "@/app/(app)/tenders/actions";
import type { ExtractedTenderFields } from "@/lib/extraction/rfq-parser";

interface RfqExtraction {
  fields: ExtractedTenderFields;
  raw_text: string;
  no_text_found: boolean;
}

function toForm(f: ExtractedTenderFields): TenderFormFields {
  return {
    title: f.title ?? "",
    // Each extracted role becomes a one-seat line, seeded with the tender-wide
    // skills/certs the parser found. The reviewer adjusts quantities and trims
    // per-role requirements before saving.
    positions: f.required_roles.map((role) => ({
      role,
      quantity: 1,
      min_experience_years: f.min_experience_years,
      required_skills: f.required_skills,
      required_certifications: f.required_certifications,
    })),
    reference_number: f.reference_number,
    client: f.client,
    location: f.location,
    value: f.value,
    submission_deadline: f.submission_deadline,
    contract_start_date: f.contract_start_date,
    required_roles: f.required_roles,
    required_skills: f.required_skills,
    required_certifications: f.required_certifications,
    sectors: f.sectors,
    min_experience_years: f.min_experience_years,
    status: "draft",
  };
}

function toFlags(f: ExtractedTenderFields): TenderExtractedFlags {
  return {
    title: !!f.title,
    positions: f.required_roles.length > 0,
    reference_number: !!f.reference_number,
    client: !!f.client,
    location: !!f.location,
    value: f.value != null,
    submission_deadline: !!f.submission_deadline,
    contract_start_date: !!f.contract_start_date,
    required_roles: f.required_roles.length > 0,
    required_skills: f.required_skills.length > 0,
    required_certifications: f.required_certifications.length > 0,
    sectors: f.sectors.length > 0,
    min_experience_years: f.min_experience_years != null,
  };
}

export function RfqUploadZone() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<RfqExtraction | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (selected: File) => {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", selected);
      const res = await fetch("/api/tenders/extract", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not process the document.");
      }
      setFile(selected);
      setExtraction(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={cn(
          "rounded-md border border-dashed bg-card px-6 py-10 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-accent text-primary">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <ScanText className="size-5" />}
        </div>
        <h3 className="mt-3 text-headline-sm font-semibold text-foreground">
          {busy ? "Reading document..." : "Upload RFQ / RFI"}
        </h3>
        <p className="mx-auto mt-1 max-w-md text-body-sm text-muted-foreground">
          Drag and drop tender documents here, we&apos;ll parse the PDF or Word file to extract
          roles, skills, dates, and value, ready for review.
        </p>
        <div className="mt-4">
          <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            Select files
          </Button>
        </div>
        {error && <p className="mt-3 text-body-sm text-destructive">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {extraction && file && (
        <RfqReviewDialog
          extraction={extraction}
          file={file}
          onClose={() => {
            setExtraction(null);
            setFile(null);
          }}
        />
      )}
    </>
  );
}

function RfqReviewDialog({
  extraction,
  file,
  onClose,
}: {
  extraction: RfqExtraction;
  file: File;
  onClose: () => void;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<TenderFormFields>(() => toForm(extraction.fields));
  const [flags] = useState<TenderExtractedFlags>(() => toFlags(extraction.fields));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("payload", JSON.stringify(fields));
    fd.set("file", file);
    startTransition(async () => {
      const result = await createTender(fd);
      if (result.error) setError(result.error);
      else {
        onClose();
        router.push(`/tenders/${result.id}`);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border p-4">
          <div className="flex items-center gap-2">
            <DialogTitle>Review extracted tender</DialogTitle>
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-label-sm text-primary">
              <Sparkles className="size-3" />
              Auto-extracted
            </span>
          </div>
          <DialogDescription>
            Fields were pre-filled from the document. Review and correct anything before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[280px_1fr]">
          <div className="hidden min-h-0 flex-col border-r border-border bg-muted/40 md:flex">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-label-sm uppercase tracking-wide text-muted-foreground">
              <FileText className="size-3.5" />
              {file.name}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {extraction.no_text_found ? (
                <p className="text-body-sm text-muted-foreground">
                  No readable text was found in this document. Enter the details manually, the file
                  is still attached to the tender.
                </p>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-sans text-body-sm text-muted-foreground">
                  {extraction.raw_text}
                </pre>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-4">
            <TenderFields value={fields} onChange={setFields} extracted={flags} />
            {error && <p className="mt-3 text-body-sm text-destructive">{error}</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Saving..." : "Confirm & Save Tender"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
