"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UploadCloud, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CandidateFields,
  EMPTY_CANDIDATE,
  type ExtractedFlags,
} from "@/app/(app)/candidates/candidate-fields";
import { saveCandidate, type CandidateFormFields, type DuplicateMatch } from "@/app/(app)/candidates/actions";
import type { ExtractionResult } from "@/lib/extraction/types";

export function NewCandidateForm() {
  const router = useRouter();
  const [fields, setFields] = useState<CandidateFormFields>(EMPTY_CANDIDATE);
  const [flags, setFlags] = useState<ExtractedFlags>({});
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUploadCv(selected: File) {
    setFile(selected);
    setParsing(true);
    setParseNote(null);
    try {
      const fd = new FormData();
      fd.set("file", selected);
      const res = await fetch("/api/candidates/extract", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const result: ExtractionResult = await res.json();
      const f = result.fields;
      const nextFlags: ExtractedFlags = {};
      const union = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));
      setFields((prev) => {
        const next = { ...prev };
        if (f.full_name) { next.full_name = f.full_name; nextFlags.full_name = true; }
        if (f.email) { next.email = f.email; nextFlags.email = true; }
        if (f.phone) { next.phone = f.phone; nextFlags.phone = true; }
        if (f.linkedin_url) { next.linkedin_url = f.linkedin_url; nextFlags.linkedin_url = true; }
        if (f.portfolio_url) { next.portfolio_url = f.portfolio_url; nextFlags.portfolio_url = true; }
        if (f.current_role) { next.current_role = f.current_role; nextFlags.current_role = true; }
        if (f.professional_summary) { next.professional_summary = f.professional_summary; nextFlags.professional_summary = true; }
        if (f.years_experience != null) { next.years_experience = f.years_experience; nextFlags.years_experience = true; }
        if (f.additional_roles.length) { next.additional_roles = union(prev.additional_roles, f.additional_roles); nextFlags.additional_roles = true; }
        if (f.technical_skills.length) { next.technical_skills = union(prev.technical_skills, f.technical_skills); nextFlags.technical_skills = true; }
        if (f.skills.length) { next.skills = union(prev.skills, f.skills); nextFlags.skills = true; }
        if (f.certifications.length) { next.certifications = union(prev.certifications, f.certifications); nextFlags.certifications = true; }
        if (f.qualifications.length) { next.qualifications = union(prev.qualifications, f.qualifications); nextFlags.qualifications = true; }
        if (f.sectors.length) { next.sectors = union(prev.sectors, f.sectors); nextFlags.sectors = true; }
        if (f.languages.length) { next.languages = union(prev.languages, f.languages); nextFlags.languages = true; }
        if (f.work_experience.length) { next.work_experience = [...prev.work_experience, ...f.work_experience]; nextFlags.work_experience = true; }
        if (f.education.length) { next.education = [...prev.education, ...f.education]; nextFlags.education = true; }
        return next;
      });
      setFlags(nextFlags);
      setParseNote(
        result.no_text_found
          ? "No text could be read from the file. It will be attached, but enter the details manually."
          : "Pre-filled from the CV. Review the highlighted fields, then save.",
      );
    } catch {
      setParseNote("Could not read the file, but it will still be attached on save.");
    } finally {
      setParsing(false);
    }
  }

  function save(force: boolean) {
    setError(null);
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ ...fields, force }));
    if (file) fd.set("file", file);
    startTransition(async () => {
      const result = await saveCandidate(fd);
      if (result.status === "success") {
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
    <div className="space-y-5">
      {/* Optional CV pre-fill */}
      <div className="rounded-md border border-dashed border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-body-sm font-medium text-foreground">
              Have a CV? Upload it to pre-fill the form
            </div>
            <div className="mt-0.5 text-body-sm text-muted-foreground">
              {file ? file.name : "Optional. You can also fill everything in manually below."}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
            Upload CV to pre-fill
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadCv(f);
              e.target.value = "";
            }}
          />
        </div>
        {parseNote && <p className="mt-2 text-body-sm text-primary">{parseNote}</p>}
      </div>

      {duplicate && (
        <div className="rounded-md border border-strong-match/40 bg-strong-match/10 p-3">
          <div className="flex items-center gap-2 text-body-sm font-medium text-foreground">
            <AlertTriangle className="size-4 text-strong-match" />
            Possible duplicate candidate
          </div>
          <p className="mt-1 text-body-sm text-muted-foreground">
            <span className="font-medium text-foreground">{duplicate.full_name}</span> already exists
            with the same {duplicate.email ? "email" : "phone"}.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" render={<Link href={`/candidates/${duplicate.id}`} />} nativeButton={false}>
              Open existing
            </Button>
            <Button variant="secondary" size="sm" onClick={() => save(true)} disabled={isPending}>
              Save as new anyway
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-5">
        <CandidateFields value={fields} onChange={setFields} extracted={flags} />
      </div>

      {error && <p className="text-body-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" render={<Link href="/candidates" />} nativeButton={false}>
          Cancel
        </Button>
        <Button onClick={() => save(false)} disabled={isPending || parsing}>
          {isPending ? "Saving..." : "Save candidate"}
        </Button>
      </div>
    </div>
  );
}
