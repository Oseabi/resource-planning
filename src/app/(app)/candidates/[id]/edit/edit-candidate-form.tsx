"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CandidateFields, type ExtractedFlags } from "@/app/(app)/candidates/candidate-fields";
import {
  updateCandidate,
  type CandidateFormFields,
  type DuplicateMatch,
} from "@/app/(app)/candidates/actions";
import type { ExtractionResult } from "@/lib/extraction/types";

export function EditCandidateForm({
  candidateId,
  initial,
  currentCvName,
}: {
  candidateId: string;
  initial: CandidateFormFields;
  currentCvName: string | null;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<CandidateFormFields>(initial);
  const [flags, setFlags] = useState<ExtractedFlags>({});
  const [newFile, setNewFile] = useState<File | null>(null);
  const [reparsing, setReparsing] = useState(false);
  const [reparseNote, setReparseNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleReplaceCv(file: File) {
    setNewFile(file);
    setReparsing(true);
    setReparseNote(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/candidates/extract", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const result: ExtractionResult = await res.json();
      // Merge any newly-extracted values over the current fields, highlighting them.
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
      setReparseNote(
        result.no_text_found
          ? "No text could be read from the new file — it will be attached, but review fields manually."
          : "Re-extracted from the new CV. Review the highlighted fields before saving.",
      );
    } catch {
      setReparseNote("Could not read the new file, but it will still be attached on save.");
    } finally {
      setReparsing(false);
    }
  }

  function save(force: boolean) {
    setError(null);
    const fd = new FormData();
    fd.set("candidateId", candidateId);
    fd.set("payload", JSON.stringify({ ...fields, force }));
    if (newFile) fd.set("file", newFile);
    startTransition(async () => {
      const result = await updateCandidate(fd);
      if (result.status === "success") {
        router.push(`/candidates/${candidateId}`);
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
      <div className="rounded-lg border border-border bg-card shadow-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-label-sm uppercase tracking-wide text-muted-foreground">
              CV file
            </div>
            <div className="mt-0.5 text-body-sm text-foreground">
              {newFile ? newFile.name : (currentCvName ?? "No CV attached")}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={reparsing}
          >
            {reparsing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Replace CV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleReplaceCv(f);
              e.target.value = "";
            }}
          />
        </div>
        {reparseNote && <p className="mt-2 text-body-sm text-primary">{reparseNote}</p>}
      </div>

      {duplicate && (
        <div className="rounded-md border border-strong-match/40 bg-strong-match/10 p-3">
          <div className="flex items-center gap-2 text-body-sm font-medium text-foreground">
            <AlertTriangle className="size-4 text-strong-match" />
            Another candidate has the same {duplicate.email ? "email" : "phone"}
          </div>
          <p className="mt-1 text-body-sm text-muted-foreground">
            <span className="font-medium text-foreground">{duplicate.full_name}</span> already uses
            these details.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" size="sm" render={<Link href={`/candidates/${duplicate.id}`} />} nativeButton={false}>
              Open existing
            </Button>
            <Button variant="secondary" size="sm" onClick={() => save(true)} disabled={isPending}>
              Save anyway
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card shadow-card p-5">
        <CandidateFields value={fields} onChange={setFields} extracted={flags} />
      </div>

      {error && <p className="text-body-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" render={<Link href={`/candidates/${candidateId}`} />} nativeButton={false}>
          Cancel
        </Button>
        <Button onClick={() => save(false)} disabled={isPending || reparsing}>
          {isPending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
