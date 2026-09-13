"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TenderFields } from "@/app/(app)/tenders/tender-fields";
import type { DepartmentOption } from "@/lib/departments";
import {
  createTender,
  updateTender,
  type TenderFormFields,
} from "@/app/(app)/tenders/actions";

export function TenderForm({
  mode,
  tenderId,
  initial,
  departments = [],
  ownDepartmentName = null,
}: {
  mode: "create" | "edit";
  tenderId?: string;
  initial: TenderFormFields;
  departments?: DepartmentOption[];
  ownDepartmentName?: string | null;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<TenderFormFields>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!fields.title.trim()) {
      setError("Title is required.");
      return;
    }
    // An admin without a department of their own has nothing to fall back
    // on; the server refuses the save, so this says so before the round trip.
    if (mode === "create" && departments.length > 0 && !fields.department_id && !ownDepartmentName) {
      setError("Pick a department for this tender.");
      return;
    }
    startTransition(async () => {
      try {
        let result;
        if (mode === "create") {
          const fd = new FormData();
          fd.set("payload", JSON.stringify(fields));
          result = await createTender(fd);
        } else {
          result = await updateTender(tenderId!, fields);
        }
        if (result.error) setError(result.error);
        else {
          router.push(`/tenders/${result.id}`);
          router.refresh();
        }
      } catch (e) {
        setError(`Could not save the tender: ${e instanceof Error ? e.message : "the request failed"}.`);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card shadow-card p-5">
        <TenderFields
          value={fields}
          onChange={setFields}
          departments={departments}
          ownDepartmentName={ownDepartmentName}
        />
      </div>
      {error && <p className="text-body-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          render={<Link href={mode === "edit" && tenderId ? `/tenders/${tenderId}` : "/tenders"} />}
          nativeButton={false}
        >
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Saving..." : mode === "create" ? "Create tender" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
