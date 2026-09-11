import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractDocumentText, extractDocumentTablesWithMeta } from "@/lib/extraction/text";
import { parseTextToFields } from "@/lib/extraction/local-parser";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function readFixture(name: string): Promise<ArrayBuffer> {
  const buf = await readFile(join(FIX, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("extractDocumentText, real files", () => {
  it("reads text from a .docx via mammoth and parses fields", async () => {
    const buffer = await readFixture("sample-cv.docx");
    const text = await extractDocumentText(buffer, DOCX_MIME, "sample-cv.docx");
    expect(text).toContain("James H. Carter");
    expect(text).toContain("Revit");

    const fields = parseTextToFields(text, "sample-cv.docx");
    expect(fields.full_name).toBe("James H. Carter");
    expect(fields.email).toBe("james.carter@example.com");
    expect(fields.current_role).toBe("Senior Structural Engineer");
    expect(fields.years_experience).toBe(15);
    expect(fields.technical_skills).toContain("Revit");
    expect(fields.technical_skills).toContain("Tekla Structures");
    expect(fields.certifications).toContain("CSCS Gold");
    expect(fields.sectors).toContain("Rail");
  });

  it("reads text from a PDF via unpdf and parses fields", async () => {
    const buffer = await readFixture("sample-cv.pdf");
    const text = await extractDocumentText(buffer, "application/pdf", "sample-cv.pdf");
    expect(text).toContain("James H. Carter");
    expect(text).toContain("Structural Engineer");

    const fields = parseTextToFields(text, "sample-cv.pdf");
    expect(fields.email).toBe("james.carter@example.com");
    expect(fields.current_role).toBe("Senior Structural Engineer");
    expect(fields.certifications).toContain("CSCS Gold");
  });
});

describe("reading one buffer twice", () => {
  // planExtraction reads the text and the tables of the same buffer at the
  // same time. pdf.js hands the bytes to its worker by transfer, which
  // detaches the buffer, so the second reader used to get "Cannot transfer
  // object of unsupported type", the tables catch swallowed it, and every
  // PDF of the template came back as its header and nothing else.
  it("does not let the text reader detach the buffer under the table reader", async () => {
    const buffer = await readFixture("sample-cv.pdf");
    const [text, tables] = await Promise.all([
      extractDocumentText(buffer, "application/pdf", "sample-cv.pdf"),
      extractDocumentTablesWithMeta(buffer, "application/pdf", "sample-cv.pdf"),
    ]);
    expect(text).toContain("James H. Carter");
    expect(buffer.byteLength).toBeGreaterThan(0);
    // The sample is prose, which the reader hands back as one-cell rows for
    // the template parser to decline. The point is that it was read at all.
    expect(tables.tables.length).toBeGreaterThan(0);
    expect(tables.tables[0][0][0]).toContain("James H. Carter");
  });
});
