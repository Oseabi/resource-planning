import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TenderForm } from "@/app/(app)/tenders/tender-form";
import { EMPTY_TENDER } from "@/app/(app)/tenders/tender-fields";

export default function NewTenderPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/tenders" className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Back to tenders
      </Link>
      <div>
        <h1 className="text-display font-semibold text-foreground">Create tender</h1>
        <p className="mt-1 text-body-lg text-muted-foreground">
          Define the bid and its team requirements, then match candidates against it.
        </p>
      </div>
      <TenderForm mode="create" initial={EMPTY_TENDER} />
    </div>
  );
}
