"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSignedCvUrl } from "@/app/(app)/candidates/actions";

export function CvDownloadButton({
  path,
  filename,
}: {
  path: string;
  filename: string | null;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
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
