import type { ReactNode } from "react";
import Image from "next/image";

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-1.5">
          <Image
            src="/tipp-focus-logo.png"
            alt="TiPP FOCUS"
            width={168}
            height={72}
            priority
          />
          <div className="text-label-sm uppercase tracking-wide text-muted-foreground">
            Resource Planning · Staffing Intelligence
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card shadow-card p-6">
          <h1 className="text-headline-md font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-body-sm text-muted-foreground">{description}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
