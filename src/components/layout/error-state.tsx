"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared error UI for route-segment error boundaries. Keeps the tone calm and
 * gives the user a way forward (retry) rather than a raw stack trace.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this page. This is usually temporary, try again in a moment.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </div>
      <h1 className="text-headline-md font-semibold text-foreground">{title}</h1>
      <p className="mt-2 max-w-md text-body-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button className="mt-6" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
