import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReferenceLetterForm } from "@/app/(app)/reference-letters/letter-form";

export default function NewReferenceLetterPage() {
  return (
    <div className="space-y-6">
      <Link
        href="/reference-letters"
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to reference letters
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Add a reference letter</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          A past client confirming work you delivered, for answering a tender&apos;s reference
          requirement.
        </p>
      </div>
      <ReferenceLetterForm />
    </div>
  );
}
