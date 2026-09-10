"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv } from "@/lib/csv";

/**
 * Hands the rows straight to a file.
 *
 * The rows come from the server already shaped, so this does no filtering of
 * its own: what somebody downloads is exactly what they were looking at, which
 * is the only way an export is worth anything as evidence.
 *
 * The byte order mark is added here rather than in toCsv. Excel needs it to
 * read UTF-8, and a name like Müller or Nkosinathi comes out mangled without
 * it, but it has no business inside a string anything else might compare.
 */
export function ExportButton({
  headers,
  rows,
  filename,
  label = "Export CSV",
}: {
  headers: string[];
  rows: (string | number | null)[][];
  filename: string;
  label?: string;
}) {
  function download() {
    const blob = new Blob(["﻿" + toCsv(headers, rows)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={download} disabled={rows.length === 0}>
      <Download className="size-4" />
      {label}
    </Button>
  );
}
