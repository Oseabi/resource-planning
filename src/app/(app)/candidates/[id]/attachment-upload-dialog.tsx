"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComboboxInput } from "@/components/ui/combobox-input";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_KINDS,
  attachmentFileError,
  attachmentKindLabel,
} from "@/lib/candidate-attachments";
import { uploadCandidateAttachment } from "@/app/(app)/candidates/attachment-actions";
import type { CandidateAttachmentKind } from "@/lib/supabase/database.types";

/** A filename without its extension, as a sensible first draft of the title. */
function titleFromFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim();
}

/**
 * Attach a document to a person's file.
 *
 * In a dialog on the profile rather than in the edit form, because attaching a
 * file is an action and not a field: nobody opens a nine-section form to add a
 * certificate scan. Certificate titles come from the names already on the
 * record, so the TOGAF line the CV prints and the TOGAF scan behind it end up
 * called the same thing without anybody typing it twice.
 */
export function AttachmentUploadDialog({
  candidateId,
  certificateNames,
}: {
  candidateId: string;
  /** The names on the record's certificates, offered on the title field. */
  certificateNames: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CandidateAttachmentKind>("certificate");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const hint = ATTACHMENT_KINDS.find((k) => k.value === kind)?.hint ?? "";

  function reset() {
    setKind("certificate");
    setTitle("");
    setFile(null);
    setError(null);
  }

  function choose(picked: File) {
    setFile(picked);
    // Said now rather than after a round trip. The action checks again.
    setError(attachmentFileError(picked));
    if (!title.trim()) setTitle(titleFromFilename(picked.name));
  }

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("candidateId", candidateId);
    fd.set("payload", JSON.stringify({ kind, title }));
    if (file) fd.set("file", file);

    startTransition(async () => {
      const result = await uploadCandidateAttachment(fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Paperclip className="size-4" />
        Add document
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach a document</DialogTitle>
          <DialogDescription>
            A certificate, a qualification, an ID copy or a signed contract. The CV has its own
            place above and is replaced from the edit form.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="at-kind">Kind of document</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind((v ?? "certificate") as CandidateAttachmentKind)}
            >
              <SelectTrigger id="at-kind" className="w-full">
                <SelectValue>{(v) => attachmentKindLabel(v as CandidateAttachmentKind)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ATTACHMENT_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-body-sm text-muted-foreground">{hint}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="at-title">Title</Label>
            {/* The record's own certificate names, so a TOGAF scan is one tap.
                Nothing to offer on the other kinds, so a plain field there. */}
            {kind === "certificate" ? (
              <ComboboxInput
                id="at-title"
                value={title}
                onChange={(v) => setTitle(v ?? "")}
                suggestions={certificateNames}
                placeholder="e.g. TOGAF 9 Foundation"
              />
            ) : (
              <Input
                id="at-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What this document is called"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>File</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" />
                {file ? "Choose another" : "Select file"}
              </Button>
              <span className="min-w-0 truncate text-body-sm text-muted-foreground">
                {file?.name ?? "No file chosen"}
              </span>
            </div>
            <p className="text-body-sm text-muted-foreground">
              PDF, Word .docx, or a PNG or JPEG scan, up to 10 MB.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) choose(picked);
                // Cleared so picking the same file twice still fires.
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {error && <p className="text-body-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending || !file || !title.trim()}>
            {isPending ? "Attaching..." : "Attach document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
