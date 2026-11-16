"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSignedCvUrl } from "@/app/(app)/candidates/actions";

export function CvDownloadButton({
  path,
  href,
  filename,
}: {
  /** A tender document's object path, signed on click. */
  path?: string;
  /** The app's own file route (candidate CVs); opened directly. */
  href?: string;
  filename: string | null;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (!path) return;
    setLoading(true);
    const { url } = await getSignedCvUrl(path);
    setLoading(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={loading}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      {filename ?? "Download CV"}
    </Button>
  );
}
