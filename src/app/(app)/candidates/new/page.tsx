import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewCandidateForm } from "@/app/(app)/candidates/new/new-candidate-form";

export default function NewCandidatePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/candidates"
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to candidates
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Add candidate</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Enter the details manually, or upload a CV to pre-fill the form.
        </p>
      </div>
      <NewCandidateForm />
    </div>
  );
}
