/**
 * Benchmark the extraction parsers against a folder of real documents.
 *
 *   npx tsx scripts/bench-extraction.ts tender "<folder>" [--files list.txt]
 *   npx tsx scripts/bench-extraction.ts cv     "<folder>" [--files list.txt]
 *
 * With a real key, to read what the AI changes before trusting it:
 *
 *   npx tsx --conditions=react-server --env-file=.env.local  *     scripts/bench-extraction.ts cv "<folder>" --ai
 *
 * The react-server condition makes the server-only guard resolve to nothing,
 * which is how the AI extractor can be loaded outside Next. Prints the local
 * result and the merged result side by side for every generic CV, skips every
 * TiPP one, and waits a minute between calls because the free tier allows
 * 8,000 tokens a minute and one CV is most of that.
 *
 * Exists because "improve the parser" has failed twice by tuning rules to
 * whichever documents happened to be open. Heuristics look excellent on the
 * documents they were written against and fall over on the next one, so the
 * only honest way to work is to measure a lot of documents at once, and to keep
 * a set aside that is never looked at while writing rules.
 *
 * Prints one line per field per document so a regression is visible as a
 * changed line rather than a changed feeling.
 *
 * Reads text the same way the app does, but without importing text.ts, which is
 * server-only and cannot load outside Next.
 */
import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { extractPdfTextWithLines, type PdfDocumentLike } from "@/lib/extraction/pdf-lines";
import { parseRfqText } from "@/lib/extraction/rfq-parser";
import { parseTextToFields, isTippCv, tippParsedFully } from "@/lib/extraction/local-parser";
import { tablesFromHtml } from "@/lib/extraction/docx-tables";
import { tablesFromPdfPages, pdfItemsFrom, type PdfPageItems } from "@/lib/extraction/pdf-tables";
import { mergeExtraction } from "@/lib/extraction/ai-fields";
import type { ExtractedCandidateFields } from "@/lib/extraction/types";

const WITH_AI = process.argv.includes("--ai");
/** A minute, plus a little, between calls. The budget is per minute. */
const AI_PAUSE_MS = 65_000;

function cvLines(f: ExtractedCandidateFields): string[] {
  return [
    `  name     ${show(f.full_name)}`,
    `  role     ${show(f.current_role)}`,
    `  years    ${show(f.years_experience)}`,
    `  avail    ${show(f.availability)}`,
    `  langs    ${show(f.languages)}`,
    `  summary  ${show(f.professional_summary, 60)}`,
    `  skills   ${f.skills.length} | tech ${f.technical_skills.length} | certs ${f.certifications.length}`,
    `  work     ${f.work_experience.length} | education ${f.education.length}`,
    `  quals    ${show(f.qualifications)}`,
    `  work[0]  ${show(f.work_experience[0] ? `${f.work_experience[0].title} @ ${f.work_experience[0].company}` : null)}`,
    `  email    ${f.email ? "SET" : "-"} | phone ${f.phone ? "SET" : "-"}`,
    `  dob      ${f.date_of_birth ? "set" : "-"} | group ${show(f.designated_group)}`,
    `  matrix   ${(f.skill_matrix ?? []).length} categories, ${(f.skill_matrix ?? []).reduce((n, c) => n + c.skills.length, 0)} skills`,
    `  certs+   ${(f.certificates ?? []).length} with detail | projects ${(f.projects ?? []).length} | achievements ${f.achievements ? f.achievements.length + " chars" : "-"}`,
    `  clients  ${f.work_experience.filter((w) => w.client).length} of ${f.work_experience.length} jobs`,
  ];
}

async function readDocument(file: string): Promise<string> {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  if (file.toLowerCase().endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(ab));
    try {
      const lined = await extractPdfTextWithLines(pdf as unknown as PdfDocumentLike);
      if (lined.trim().length > 0) return lined;
    } catch {
      // Fall through to the flat extractor, same as the app does.
    }
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  }

  if (/\.docx?$/i.test(file)) {
    return (await mammoth.extractRawText({ buffer: Buffer.from(ab) })).value;
  }
  if (file.toLowerCase().endsWith(".txt")) return fs.readFileSync(file, "utf8");

  throw new Error("unsupported: " + path.extname(file));
}

const show = (v: unknown, len = 68): string => {
  if (v === null || v === undefined) return "-";
  if (Array.isArray(v)) return v.length === 0 ? "-" : JSON.stringify(v.slice(0, 5));
  const s = String(v);
  return s.length > len ? s.slice(0, len) + "..." : s;
};

async function benchTender(file: string) {
  const text = await readDocument(file);
  const f = parseRfqText(text, path.basename(file));
  return [
    `  chars    ${text.length}`,
    `  title    ${show(f.title)}`,
    `  client   ${show(f.client)}`,
    `  ref      ${show(f.reference_number)}`,
    `  deadline ${show(f.submission_deadline)}`,
    `  value    ${show(f.value)}`,
    `  minExp   ${show(f.min_experience_years)}`,
    `  roles    ${show(f.required_roles)}`,
    `  skills   ${f.required_skills.length} | certs ${f.required_certifications.length}`,
  ];
}

async function benchCv(file: string) {
  const text = await readDocument(file);
  // Mirrors the app: a .docx yields its tables through mammoth and a PDF
  // through the positions of its runs, and the parser prefers either to text.
  let tables: string[][][] = [];
  let coverAsOf: string | null = null;
  if (/.docx$/i.test(file)) {
    const { value } = await mammoth.convertToHtml({ path: file });
    tables = tablesFromHtml(value);
  } else if (/.pdf$/i.test(file)) {
    const buf = fs.readFileSync(file);
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const pages: PdfPageItems[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { items } = await page.getTextContent();
      pages.push({ items: pdfItemsFrom(items as unknown[]) });
    }
    const result = tablesFromPdfPages(pages);
    tables = result.tables;
    coverAsOf = result.coverAsOf;
  }
  const f = parseTextToFields(text, path.basename(file), tables);
  const tipp = isTippCv(text, tables);
  // Recognised and read is the only case that stays local. A PDF of the
  // template is recognised, gets its header read, and loses its tables.
  const source = tipp ? (tippParsedFully(f) ? "tipp" : "tipp, header only") : "generic";
  const lines = [
    `  chars    ${text.length}`,
    `  source   ${source}${tables.length > 0 ? ` (${tables.length} tables)` : ""}`,
    ...(coverAsOf ? [`  as of    ${coverAsOf}`] : []),
    ...cvLines(f),
  ];

  if (!WITH_AI) return lines;
  if (source === "tipp") return [...lines, "  ai       skipped, a TiPP CV read in full never goes to the AI"];

  // Loaded here rather than at the top so the plain run never touches a
  // server-only module and never needs the react-server condition.
  const { extractWithAi, isAiExtractionConfigured } = await import("@/lib/extraction/ai-extractor");
  if (!isAiExtractionConfigured()) return [...lines, "  ai       GROQ_API_KEY not set"];

  const started = Date.now();
  const ai = await extractWithAi(text);
  const took = ((Date.now() - started) / 1000).toFixed(1);
  if (!ai.ok) return [...lines, `  ai       FAILED after ${took}s: ${ai.reason}`];

  const merged = mergeExtraction(f, ai.fields);
  lines.push(`  ai       ok in ${took}s${ai.truncated ? ", text was truncated" : ""}`);
  lines.push("  --- merged (local + ai) ---");
  lines.push(...cvLines(merged));

  await new Promise((r) => setTimeout(r, AI_PAUSE_MS));
  return lines;
}

const [mode, folder] = process.argv.slice(2);
if (!mode || !folder) {
  console.error("usage: npx tsx scripts/bench-extraction.ts <tender|cv> <folder> [--files list.txt]");
  process.exit(1);
}

const listArg = process.argv.indexOf("--files");
const files =
  listArg > -1
    ? fs
        .readFileSync(process.argv[listArg + 1], "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
    : fs.readdirSync(folder).filter((f) => /\.(pdf|docx?|txt)$/i.test(f));

async function main() {
  const out: string[] = [];
  for (const name of files) {
    const full = path.join(folder, name);
    out.push("=== " + name);
    if (!fs.existsSync(full)) {
      out.push("  MISSING");
      continue;
    }
    try {
      out.push(...(mode === "cv" ? await benchCv(full) : await benchTender(full)));
    } catch (e) {
      out.push("  ERROR " + (e as Error).message.slice(0, 100));
    }
  }
  
  const report = out.join("\n");
  fs.writeFileSync(`bench-${mode}.txt`, report);
  console.log(report);
  console.log(`\nWrote bench-${mode}.txt (${files.length} documents)`);
  
}

main();
