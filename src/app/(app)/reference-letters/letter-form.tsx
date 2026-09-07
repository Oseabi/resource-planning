"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ReferenceLetterFields,
  EMPTY_REFERENCE_LETTER,
} from "@/app/(app)/reference-letters/letter-fields";
import {
  createReferenceLetter,
  updateReferenceLetter,
  type ReferenceLetterFormFields,
} from "@/app/(app)/reference-letters/actions";

/**
 * Shared create/edit form. `letterId` switches it to update mode; the file input
 * is optional on edit, and leaving it empty keeps the stored document.
 */
export function ReferenceLetterForm({
  letterId,
  initial,
  currentFileName,
}: {
  letterId?: string;
  initial?: ReferenceLetterFormFields;
  currentFileName?: string | null;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<ReferenceLetterFormFields>(
    initial ?? EMPTY_REFERENCE_LETTER,
  );
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const isEdit = Boolean(letterId);

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("payload", JSON.stringify(fields));
    if (letterId) fd.set("letterId", letterId);
    if (file) fd.set("file", file);

    startTransition(async () => {
      const result = isEdit ? await updateReferenceLetter(fd) : await createReferenceLetter(fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(result.id ? `/reference-letters/${result.id}` : "/reference-letters");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-5 shadow-card">
        <ReferenceLetterFields value={fields} onChange={setFields} />

        <div className="mt-5 space-y-1.5">
          <Label>Signed letter</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" />
              {file || currentFileName ? "Replace file" : "Select file"}
            </Button>
            <span className="text-body-sm text-muted-foreground">
              {file?.name ?? currentFileName ?? "No file attached"}
            </span>
          </div>
          <p className="text-body-sm text-muted-foreground">
            PDF, Word, or a scan of the signed letter. A reference with no document behind it
            cannot go into a bid pack.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {error && <p className="text-body-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          render={<Link href={letterId ? `/reference-letters/${letterId}` : "/reference-letters"} />}
          nativeButton={false}
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={isPending}>
          {isPending ? "Saving..." : isEdit ? "Save changes" : "Save letter"}
        </Button>
      </div>
    </div>
  );
}
