/**
 * The round trip: a real CV in, the generated CV out, the generated CV back in.
 *
 *   npx tsx --conditions=react-server scripts/roundtrip-cv.ts "<cv.pdf>" [out-dir]
 *
 * Reads a PDF of the issued template with the reader, builds the .docx from
 * exactly those fields, converts the .docx to PDF with the Word installed on
 * this machine, and reads that PDF back with the same reader. The two reads
 * are then compared field by field. If they agree, the generator has printed
 * every section where the template puts it, in a form the team's own layout
 * yields, and the reader is consistent on both. A mismatch names the field
 * and shows where the two first differ.
 *
 * Compared as words in order, not as exact strings. The team's PDFs come out
 * of Word 2016 and iLovePDF and mark every wrapped line on its last run;
 * Word 365's PDF writer marks a line that Word split into several runs with
 * a separate empty marker instead, so the reader joins a few such lines with
 * a line break rather than a space. That is a difference in the reading of
 * whitespace, not in what the document says, and this check is about what
 * the document says.
 *
 * Needs Word (it is driven through COM from PowerShell) and the react-server
 * condition, which lets the server-only generator load outside Next. Nothing
 * here touches the database or the network, and the CV never leaves the
 * machine. Writes the generated files to the out-dir, or the system temp
 * directory, so a person can open them beside the original.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getDocumentProxy } from "unpdf";
import { tablesFromPdfPages, pdfItemsFrom, type PdfPageItems } from "@/lib/extraction/pdf-tables";
import { parseTippTables } from "@/lib/extraction/tipp-tables";
import { buildTippCv, type CvSource } from "@/lib/cv-export/build-tipp-cv";
import type { ExtractedCandidateFields } from "@/lib/extraction/types";

const [file, outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tipp-roundtrip-"))] = process.argv.slice(2);
if (!file) {
  console.error('usage: npx tsx --conditions=react-server scripts/roundtrip-cv.ts "<cv.pdf>" [out-dir]');
  process.exit(1);
}

async function readPdf(pdfPath: string): Promise<{ fields: ExtractedCandidateFields; asOf: string | null }> {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(pdfPath)));
  const pages: PdfPageItems[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    pages.push({ items: pdfItemsFrom(items as unknown[]) });
  }
  const { tables, coverAsOf } = tablesFromPdfPages(pages);
  const fields = parseTippTables(tables);
  if (!fields) throw new Error(`${pdfPath} was not read as the template`);
  return { fields, asOf: coverAsOf };
}

/** Word, through COM, saving the document as PDF. Format 17 is wdFormatPDF. */
function docxToPdf(docxPath: string, pdfPath: string): void {
  const script = [
    "$word = New-Object -ComObject Word.Application",
    "$word.Visible = $false",
    "$word.DisplayAlerts = 0",
    `$doc = $word.Documents.Open('${docxPath.replace(/'/g, "''")}', $false, $true)`,
    `$doc.SaveAs2('${pdfPath.replace(/'/g, "''")}', 17)`,
    "$doc.Close($false)",
    "$word.Quit()",
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  if (result.status !== 0 || !fs.existsSync(pdfPath)) {
    throw new Error(`Word could not convert the document: ${result.stderr || result.stdout}`);
  }
}

/** The words of a value, in order, with punctuation and structure dropped. */
function words(value: unknown): string {
  const text = Array.isArray(value)
    ? value.map(words).join(" ")
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).map(words).join(" ")
      : String(value ?? "");
  return text.replace(/[^A-Za-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** The fields the template prints, as the words they carry. */
function facts(f: ExtractedCandidateFields): Record<string, string> {
  return {
    full_name: words(f.full_name),
    current_role: words(f.current_role),
    date_of_birth: words(f.date_of_birth),
    designated_group: words(f.designated_group),
    years_experience: words(f.years_experience),
    availability_note: words(f.availability_note),
    professional_summary: words(f.professional_summary),
    education: words(f.education.map((e) => [e.qualification, e.institution, e.year])),
    certificates: words((f.certificates ?? []).map((c) => [c.name, c.institution, c.year])),
    skill_matrix: words((f.skill_matrix ?? []).map((c) => [c.category, c.skills.map((s) => [s.name, s.years, s.note])])),
    projects: words(f.projects),
    achievements: words(f.achievements),
    work_experience: words(
      f.work_experience.map((w) => [w.title, w.company, w.client, w.start_date, w.end_date, w.is_current, w.description]),
    ),
  };
}

/** Where two long strings first differ, for a mismatch that is not obvious. */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return `\n      original:  ...${a.slice(from, i + 80)}\n      generated: ...${b.slice(from, i + 80)}`;
}

async function main() {
  const original = await readPdf(file);
  const source = original.fields as unknown as CvSource;

  const docx = buildTippCv(source, {
    manager: { name: "Samantha Example", email: "cv@example.com", phone: "011 000 0000" },
    asOf: new Date(),
    generatedBy: "roundtrip-cv",
  });
  const base = path.join(outDir, path.basename(file, path.extname(file)));
  fs.writeFileSync(`${base}.generated.docx`, docx);
  docxToPdf(`${base}.generated.docx`, `${base}.generated.pdf`);

  const generated = await readPdf(`${base}.generated.pdf`);

  const a = facts(original.fields);
  const b = facts(generated.fields);
  let failures = 0;
  console.log(`=== ${path.basename(file)}`);
  console.log(`  cover as of  original ${original.asOf ?? "-"} | generated ${generated.asOf ?? "-"}`);
  for (const key of Object.keys(a)) {
    const same = a[key] === b[key];
    if (!same) failures++;
    console.log(`  ${key.padEnd(20)} ${same ? "PASS" : "FAIL" + firstDifference(a[key], b[key])}`);
  }
  console.log(`\nfiles in ${outDir}`);
  if (failures > 0) {
    console.log(`${failures} field(s) differ`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
