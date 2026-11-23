"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Open a stored file through the app's own file route (CVs, documents, RFQ
 * documents). A plain new-tab open straight from the click, so no popup
 * blocker stands in the way and no storage link reaches the browser.
 */
export function CvDownloadButton({ href, filename }: { href: string; filename: string | null }) {
  return (
    <Button variant="outline" size="sm" onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>
      <Download className="size-4" />
      {filename ?? "Download CV"}
    </Button>
  );
}
