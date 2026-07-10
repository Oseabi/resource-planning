import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
        <Compass className="size-6" />
      </div>
      <p className="text-label-md font-medium uppercase tracking-wide text-muted-foreground">
        Error 404
      </p>
      <h1 className="mt-1 text-display font-semibold text-foreground">Page not found</h1>
      <p className="mt-2 max-w-md text-body-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have been moved.
      </p>
      <Button className="mt-6" nativeButton={false} render={<Link href="/dashboard" />}>
        Back to dashboard
      </Button>
    </main>
  );
}
