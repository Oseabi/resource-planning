import "server-only";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { missingTemplateFields, type CvSource } from "@/lib/cv-export/missing-fields";

export { missingTemplateFields };
export type { CvSource };

/**
 * Write a candidate out as a TiPP Focus CV.
 *
 * The template committed alongside this file is a real CV with its content
 * replaced by tags, so the logo, page headers, fonts and table borders are the
 * genuine article rather than a reconstruction. That matters because the output
 * goes to a client with a bid. See scripts/build-cv-template.mjs for how it is
 * produced, and re-run that script rather than hand-editing the .docx.
 */

const TEMPLATE_PATH = path.join(process.cwd(), "src", "lib", "cv-export", "tipp-focus-template.docx");

/** How the app's availability values read on a CV. */
const AVAILABILITY_TEXT: Record<string, string> = {
  available: "Immediately Available",
  notice_period: "On notice",
  unavailable: "Not currently available",
};

/** A duration cell, written the way the template writes them. */
function durationCell(entry: { start_date?: string | null; end_date?: string | null; is_current?: boolean }): string {
  const start = entry.start_date?.trim();
  if (!start) return "";
  if (entry.is_current) return `${start} - Current`;
  const end = entry.end_date?.trim();
  return end ? `${start} - ${end}` : start;
}

/** Duties come off the description, one line each, with any Client line dropped. */
function dutyLines(description: string | null | undefined): string[] {
  if (!description) return [];
  return description
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•\-*]+/, "").trim())
    // The client has its own row in the template, so repeating it as a duty
    // would print it twice.
    .filter((line) => line.length > 0 && !/^client:/i.test(line));
}

/** The client, when the parser recorded one on the description's first line. */
function clientOf(description: string | null | undefined): string | null {
  const match = description?.match(/^\s*client:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

/** Map a candidate onto the template's tags. Exported for its unit tests. */
export function toTemplateData(source: CvSource) {
  const career = source.work_experience.map((entry) => ({
    company: entry.company ?? "",
    role: entry.title ?? "",
    duration: durationCell(entry),
  }));

  const education = source.education.length
    ? source.education.map((entry) => ({
        qualification: entry.qualification ?? "",
        institution: entry.institution ?? "",
        year: entry.year ?? "",
      }))
    : // Older records carry qualifications as bare strings with no institution.
      source.qualifications.map((q) => ({ qualification: q, institution: "", year: "" }));

  return {
    full_name: source.full_name ?? "",
    position: source.current_role ?? "",
    designated_group: source.designated_group ?? "",
    languages: source.languages.join(", "),
    availability: source.availability
      ? (AVAILABILITY_TEXT[source.availability] ?? source.availability)
      : "",
    summary: source.professional_summary ?? "",
    career,
    education,
    certificates: source.certifications.map((c) => ({
      qualification: c,
      institution: "",
      year: "",
    })),
    // Professional and technical skills share one list on the CV, as the
    // template has a single SKILLS block.
    skills: [...source.skills, ...source.technical_skills],
    employment: source.work_experience.map((entry) => {
      const client = clientOf(entry.description);
      return {
        company: entry.company ?? "",
        role: entry.title ?? "",
        duration: durationCell(entry),
        client: client ?? "",
        // Zero or one entries, so the Client row renders only when there is one.
        has_client: client ? [client] : [],
        duties: dutyLines(entry.description),
      };
    }),
  };
}

/** A filename that will not surprise anyone in a bid folder. */
export function cvFilename(fullName: string): string {
  const safe = (fullName || "candidate").replace(/[^A-Za-z0-9 ]+/g, "").trim() || "candidate";
  return `TippFocus - ${safe}.docx`;
}

/** Render the candidate into the template and return the .docx bytes. */
export function buildTippCv(source: CvSource): Buffer {
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // A field the record cannot fill leaves the cell empty rather than printing
    // "undefined" into a document that goes to a client.
    nullGetter: () => "",
  });

  doc.render(toTemplateData(source));

  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
