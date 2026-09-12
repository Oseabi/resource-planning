/**
 * Render a real CV as the PDF the app would produce, for looking at.
 *
 *   npx tsx scripts/render-cv-pdf.mts "<cv.pdf>" "<out.pdf>"
 *
 * Reads the CV with the reader, then draws it with the PDF renderer. No
 * database, no network, nothing leaves the machine.
 */
import fs from "node:fs";
import { getDocumentProxy } from "unpdf";
import { tablesFromPdfPages, pdfItemsFrom, type PdfPageItems } from "@/lib/extraction/pdf-tables";
import { parseTippTables } from "@/lib/extraction/tipp-tables";
import { renderTippCvPdf } from "@/lib/cv-export/pdf/tipp-cv-pdf";
import type { CvSource } from "@/lib/cv-export/missing-fields";

const [file, out] = process.argv.slice(2);
if (!file || !out) {
  console.error('usage: npx tsx scripts/render-cv-pdf.mts "<cv.pdf>" "<out.pdf>"');
  process.exit(1);
}

const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
const pages: PdfPageItems[] = [];
for (let n = 1; n <= pdf.numPages; n++) {
  const page = await pdf.getPage(n);
  const { items } = await page.getTextContent();
  pages.push({ items: pdfItemsFrom(items as unknown[]) });
}
const fields = parseTippTables(tablesFromPdfPages(pages).tables);
if (!fields) throw new Error("not read as the template");

const buffer = await renderTippCvPdf(fields as unknown as CvSource, {
  manager: { name: "Samantha Example", email: "cv@example.com", phone: "011 000 0000" },
  asOf: new Date(),
  generatedBy: "render-cv-pdf",
});
fs.writeFileSync(out, buffer);
console.log(`wrote ${out} (${buffer.length} bytes)`);
