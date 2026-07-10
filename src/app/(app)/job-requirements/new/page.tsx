import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RequirementForm, EMPTY_REQUIREMENT } from "@/app/(app)/job-requirements/requirement-form";

export default function NewRequirementPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/job-requirements" className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to job requirements
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Create job requirement</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Define the role and requirements, then match candidates against it.
        </p>
      </div>
      <RequirementForm mode="create" initial={EMPTY_REQUIREMENT} />
    </div>
  );
}
