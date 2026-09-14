import { describe, it, expect } from "vitest";
import { filenameFromDisposition } from "@/lib/cv-export/filename";

describe("filenameFromDisposition", () => {
  it("reads the quoted name the route sends", () => {
    expect(filenameFromDisposition('attachment; filename="Tipp Construction - Nomsa Khumalo.pdf"', "x.pdf")).toBe(
      "Tipp Construction - Nomsa Khumalo.pdf",
    );
    expect(filenameFromDisposition("attachment; filename=plain.docx", "x.pdf")).toBe("plain.docx");
  });

  it("falls back when there is no header or no name in it", () => {
    expect(filenameFromDisposition(null, "TippFocus - candidate.pdf")).toBe("TippFocus - candidate.pdf");
    expect(filenameFromDisposition("attachment", "TippFocus - candidate.pdf")).toBe("TippFocus - candidate.pdf");
  });
});
