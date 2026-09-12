import "server-only";
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { missingTemplateFields, type CvSource } from "@/lib/cv-export/missing-fields";
import { durationOf } from "@/lib/cv-record";
import { formatLongDate, parseLongDate } from "@/lib/dates";
import type { AccountManager } from "@/lib/supabase/database.types";

export { missingTemplateFields };
export type { CvSource };

/**
 * Write a candidate out as a TiPP Focus CV, as it is issued.
 *
 * The template committed alongside this file is the team's own blank Word
 * template brought up to the issued layout and tagged, so the logo, page
 * headers, fonts and table borders are the genuine article rather than a
 * reconstruction. That matters because the output goes to a client with a
 * bid. See scripts/build-cv-template.mjs for how it is produced, and re-run
 * that script rather than hand-editing the .docx.
 */

/** What the cover page needs beyond the candidate: who is sending it, and when. */
export interface CvContext {
  manager: AccountManager;
  /** Printed as the cover's "As of date". */
  asOf: Date;
  /** Written into the file's properties as its author. */
  generatedBy: string;
}

const TEMPLATE_PATH = path.join(process.cwd(), "src", "lib", "cv-export", "tipp-focus-template.docx");

/** How the app's availability values read on a CV. */
const AVAILABILITY_TEXT: Record<string, string> = {
  available: "Immediately Available",
  notice_period: "On notice",
  unavailable: "Not currently available",
};

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

/** "14+ years" as the template writes it, from a number. */
function yearsText(years: number | null | undefined): string {
  if (years == null || !Number.isFinite(years) || years <= 0) return "";
  const whole = Math.floor(years);
  return `${whole}${years > whole ? "+" : ""} year${whole === 1 ? "" : "s"}`;
}

/**
 * A SKILLSET row: the category, its skills joined the way the issued CVs
 * join them, and the years once for the row when every skill agrees, else
 * beside each skill. A record with no table gets one row from its flat lists,
 * so the section is never empty on a CV that has skills.
 */
function skillsetRows(source: CvSource) {
  const matrix = source.skill_matrix ?? [];
  if (matrix.length === 0) {
    const flat = [...source.technical_skills, ...source.skills];
    return flat.length ? [{ category: "Skills", skills: flat.join("; "), years: "" }] : [];
  }
  return matrix.map((row) => {
    const years = new Set(row.skills.map((s) => s.years?.trim() || ""));
    const shared = years.size === 1 ? [...years][0] : null;
    return {
      category: row.category,
      skills: row.skills
        .map((s) => (shared === null && s.years?.trim() ? `${s.name} (${s.years.trim()})` : s.name))
        .join("; "),
      years: shared ?? "",
    };
  });
}

/** Map a candidate onto the template's tags. Exported for its unit tests. */
export function toTemplateData(source: CvSource, context: CvContext) {
  const career = source.work_experience.map((entry) => ({
    company: entry.company ?? "",
    role: entry.title ?? "",
    duration: durationOf(entry),
  }));

  const education = source.education.length
    ? source.education.map((entry) => ({
        qualification: entry.qualification ?? "",
        institution: entry.institution ?? "",
        year: entry.year ?? "",
      }))
    : // Older records carry qualifications as bare strings with no institution.
      source.qualifications.map((q) => ({ qualification: q, institution: "", year: "" }));

  const certificates = (source.certificates ?? []).length
    ? (source.certificates ?? []).map((c) => ({
        qualification: c.name,
        institution: c.institution ?? "",
        year: c.year ?? "",
      }))
    : // Records with names only, from before certificates had detail.
      source.certifications.map((c) => ({ qualification: c, institution: "", year: "" }));

  const projects = (source.projects ?? [])
    .filter((g) => g.company.trim() || g.projects.length)
    .map((g) => ({ company: g.company, names: g.projects.join("\n") }));
  const achievements = source.achievements?.trim() ?? "";

  // The date of birth arrives as an ISO date from the record and as the
  // template's own words from the review screen; both print the long way.
  const dob = source.date_of_birth?.trim() ?? "";
  const dateOfBirth = formatLongDate(parseLongDate(dob)) ?? dob;

  return {
    full_name: source.full_name ?? "",
    position: source.current_role ?? "",
    as_of_date: formatLongDate(context.asOf.toISOString().slice(0, 10)) ?? "",
    manager_name: context.manager.name,
    manager_email: context.manager.email,
    manager_phone: context.manager.phone,
    date_of_birth: dateOfBirth,
    designated_group: source.designated_group ?? "",
    years_experience: yearsText(source.years_experience),
    // The CV's own words when the record has them, the status label otherwise.
    availability:
      source.availability_note?.trim() ||
      (source.availability ? (AVAILABILITY_TEXT[source.availability] ?? source.availability) : ""),
    summary: source.professional_summary ?? "",
    career,
    education,
    certificates,
    skillset: skillsetRows(source),
    projects,
    // Zero or one entries: the whole section renders that many times.
    has_projects: projects.length ? [true] : [],
    achievements,
    has_achievements: achievements ? [true] : [],
    employment: source.work_experience.map((entry) => {
      // The field, when the record has it; the line inside the duties for
      // records saved before the client had a field of its own.
      const client = entry.client?.trim() || clientOf(entry.description);
      return {
        company: entry.company ?? "",
        role: entry.title ?? "",
        duration: durationOf(entry),
        client: client ?? "",
        // Zero or one entries, so the Client row renders only when there is one.
        has_client: client ? [client] : [],
        duties: dutyLines(entry.description),
      };
    }),
  };
}

/** A filename that will not surprise anyone in a bid folder. */
export function cvFilename(fullName: string, format: "pdf" | "docx" = "pdf"): string {
  const safe = (fullName || "candidate").replace(/[^A-Za-z0-9 ]+/g, "").trim() || "candidate";
  return `TippFocus - ${safe}.${format}`;
}

/**
 * The file's own properties: the person generating it as the author and
 * today as the date, rather than whoever built the template and the day
 * they did.
 */
function coreProperties(context: CvContext): string {
  const stamp = context.asOf.toISOString().replace(/\.\d{3}Z$/, "Z");
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    "<dc:title>Candidate Resume</dc:title>",
    `<dc:creator>${esc(context.generatedBy)}</dc:creator>`,
    `<cp:lastModifiedBy>${esc(context.generatedBy)}</cp:lastModifiedBy>`,
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>`,
    "</cp:coreProperties>",
  ].join("");
}

/** Render the candidate into the template and return the .docx bytes. */
export function buildTippCv(source: CvSource, context: CvContext): Buffer {
  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH));
  zip.file("docProps/core.xml", coreProperties(context));

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // A field the record cannot fill leaves the cell empty rather than printing
    // "undefined" into a document that goes to a client.
    nullGetter: () => "",
  });

  doc.render(toTemplateData(source, context));

  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
