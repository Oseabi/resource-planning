import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LetterForm } from "@/app/(app)/oem-letters/letter-form";

export default function NewOemLetterPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/oem-letters"
        className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to OEM letters
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Add OEM letter</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          File a manufacturer authorisation letter and tag it so it&apos;s easy to find at bid time.
        </p>
      </div>
      <LetterForm />
    </div>
  );
}
