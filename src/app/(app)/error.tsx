"use client";

import * as React from "react";
import { ErrorState } from "@/components/layout/error-state";

/**
 * Error boundary for all authenticated (app) routes. Next.js renders this when
 * a server component or data fetch throws; `reset` re-attempts the segment.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surface the error for observability; digest correlates to server logs.
    console.error(error);
  }, [error]);

  return <ErrorState onRetry={reset} />;
}
