"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, AlertTriangle, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CandidateFields, type ExtractedFlags } from "@/app/(app)/candidates/candidate-fields";
import { saveCandidate, type CandidateFormFields, type DuplicateMatch } from "@/app/(app)/candidates/actions";
import type { ExtractionResult } from "@/lib/extraction/types";

function toFields(r: ExtractionResult): CandidateFormFields {
  const f = r.fields;
  return {
    full_name: f.full_name ?? "",
    email: f.email,
    phone: f.phone,
    current_role: f.current_role,
    additional_roles: f.additional_roles,
    years_experience: f.years_experience,
    professional_summary: f.professional_summary,
    availability: "available",
    status: "active",
    location: null,
    notes: null,
    skills: f.skills,
    technical_skills: f.technical_skills,
    certifications: f.certifications,
    qualifications: f.qualifications,
    sectors: f.sectors,
    languages: f.languages,
    linkedin_url: f.linkedin_url,
    portfolio_url: f.portfolio_url,
    work_experience: f.work_experience,
    education: f.education,
  };
}

function toFlags(r: ExtractionResult): ExtractedFlags {
  const f = r.fields;
  return {
    full_name: !!f.full_name,
    email: !!f.email,
    phone: !!f.phone,
    current_role: !!f.current_role,
    additional_roles: f.additional_roles.length > 0,
    years_experience: f.years_experience != null,
    professional_summary: !!f.professional_summary,
    skills: f.skills.length > 0,
    technical_skills: f.technical_skills.length > 0,
    certifications: f.certifications.length > 0,
    qualifications: f.qualifications.length > 0,
    sectors: f.sectors.length > 0,
    languages: f.languages.length > 0,
    linkedin_url: !!f.linkedin_url,
    portfolio_url: !!f.portfolio_url,
    work_experience: f.work_experience.length > 0,
    education: f.education.length > 0,
  };
}

export function CvReviewDialog({
  open,
  onOpenChange,
  extraction,
  file,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extraction: ExtractionResult;
  file: File;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<CandidateFormFields>(() => toFields(extraction));
  const [flags] = useState<ExtractedFlags>(() => toFlags(extraction));
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(force: boolean) {
    setError(null);
    const formData = new FormData();
    formData.set("payload", JSON.stringify({ ...fields, force }));
    formData.set("file", file);
    startTransition(async () => {
      const result = await saveCandidate(formData);
      if (result.status === "success") {
        onOpenChange(false);
        router.push(`/candidates/${result.candidateId}`);
        router.refresh();
      } else if (result.status === "duplicate") {
        setDuplicate(result.match);
      } else if (result.status === "error") {
        setError(result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full flex-col p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border p-4">
          <div className="flex items-center gap-2">
            <DialogTitle>Review extracted data</DialogTitle>
            <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 text-label-sm text-primary">
              <Sparkles className="size-3" />
              {extraction.engine === "ai" ? "AI extraction" : "Auto-extracted"}
            </span>
          </div>
          <DialogDescription>
            Fields were pre-filled from the document. Review and correct anything before saving —
            nothing is saved until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[280px_1fr]">
          {/* Raw text / document panel */}
          <div className="hidden min-h-0 flex-col border-r border-border bg-muted/40 md:flex">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-label-sm uppercase tracking-wide text-muted-foreground">
              <FileText className="size-3.5" />
              {file.name}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {extraction.no_text_found ? (
                <p className="text-body-sm text-muted-foreground">
                  No readable text was found in this document (it may be a scan or image). Enter the
                  details manually — the file is still attached to the candidate.
                </p>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-sans text-body-sm text-muted-foreground">
                  {extraction.raw_text}
                </pre>
              )}
            </div>
          </div>

          {/* Editable fields */}
          <div className="min-h-0 overflow-y-auto p-4">
            {duplicate && (
              <div className="mb-4 rounded-md border border-strong-match/40 bg-strong-match/10 p-3">
                <div className="flex items-center gap-2 text-body-sm font-medium text-foreground">
                  <AlertTriangle className="size-4 text-strong-match" />
                  Possible duplicate candidate
                </div>
                <p className="mt-1 text-body-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{duplicate.full_name}</span> already
                  exists with the same {duplicate.email ? "email" : "phone"}.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" render={<Link href={`/candidates/${duplicate.id}`} />} nativeButton={false}>
                    Open existing
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => submit(true)}
                    disabled={isPending}
                  >
                    Save as new anyway
                  </Button>
                </div>
              </div>
            )}

            <CandidateFields value={fields} onChange={setFields} extracted={flags} />

            {error && <p className="mt-3 text-body-sm text-destructive">{error}</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={() => submit(false)} disabled={isPending}>
            {isPending ? "Saving..." : "Confirm & Save Candidate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
