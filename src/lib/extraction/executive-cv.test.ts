/**
 * Regression tests built from a real-world executive CV that the parser used to
 * mangle. The PDF text was arriving as a single line (unpdf `mergePages`), which
 * silently disabled every section-aware heuristic. These assertions lock in the
 * structural cases that fix exposed: ALL-CAPS headings, "TITLE <dates>" with the
 * employer on the next line, combined "EDUCATION & CERTIFICATIONS" blocks, and
 * items wrapped mid-phrase across lines.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseTextToFields } from "@/lib/extraction/local-parser";
import { splitSections } from "@/lib/extraction/sections";

const here = dirname(fileURLToPath(import.meta.url));
const CV = readFileSync(join(here, "__fixtures__", "executive-cv.txt"), "utf8");

describe("executive CV, sections", () => {
  const { sections, preamble } = splitSections(CV);

  it("keeps the name/contact block in the preamble", () => {
    expect(preamble).toContain("JORDAN SITHOLE");
  });

  it('recognises "EXECUTIVE SUMMARY" as the summary section', () => {
    expect(sections.summary).toContain("Senior programme and delivery executive");
  });

  it("routes a combined 'EDUCATION & CERTIFICATIONS' heading to both sections", () => {
    expect(sections.education).toContain("Bachelor of Commerce");
    expect(sections.certifications).toContain("PRINCE2");
  });

  it("isolates achievements so they cannot pollute skills", () => {
    expect(sections.achievements).toContain("Stabilised and recovered");
    expect(sections.skills ?? "").not.toContain("Stabilised and recovered");
  });

  it("isolates references so they cannot pollute languages", () => {
    expect(sections.references).toContain("Available upon request");
    expect(sections.languages ?? "").not.toContain("Available upon request");
  });

  it("tolerates the typo'd 'EARLIER EXPERINCES' heading", () => {
    expect(sections.experience).toContain("Financial Officer");
  });
});

describe("executive CV, parsed fields", () => {
  const f = parseTextToFields(CV, "jordan-sithole-cv.pdf");

  it("reads the ALL-CAPS name and contact details", () => {
    expect(f.full_name).toBe("Jordan Sithole");
    expect(f.email).toBe("jordan.sithole@example.com");
    expect(f.phone).toBeTruthy();
  });

  it("captures the professional summary", () => {
    expect(f.professional_summary).toContain("Senior programme and delivery executive");
  });

  it("prefers the stated years of experience over a date-span estimate", () => {
    // Roles span 2006→present (~20), but the CV states 19 years outright.
    expect(f.years_experience).toBe(19);
  });

  it("extracts every role with its employer and dates", () => {
    const titles = f.work_experience.map((e) => e.title);
    expect(titles).toContain("Senior Lead Delivery & Enterprise Architecture");
    expect(titles).toContain("Senior Manager Project & Transformation Delivery");

    const current = f.work_experience[0];
    expect(current.company).toBe("Harmony Gold");
    expect(current.is_current).toBe(true);
    expect(current.start_date).toBe("Aug 2021");

    const ey = f.work_experience.find((e) => e.company.startsWith("Ernst & Young"));
    expect(ey?.start_date).toBe("Mar 2011");
    expect(ey?.end_date).toBe("Jul 2021");
  });

  it("does not let a trailing year eat part of the job title", () => {
    // "Financial Officer 2007 – 2009" previously parsed as title "Financial".
    const titles = f.work_experience.map((e) => e.title);
    expect(titles).toContain("Financial Officer");
    expect(titles).not.toContain("Financial");
  });

  it("picks up headline roles as additional roles", () => {
    expect(f.additional_roles).toContain("Enterprise Architect");
  });

  it("classifies enterprise tooling as technical skills", () => {
    for (const skill of ["TOGAF", "LeanIX", "COBIT", "ITIL", "Azure DevOps", "SAP S/4HANA"]) {
      expect(f.technical_skills).toContain(skill);
    }
  });

  it("rejoins items the layout wrapped mid-phrase", () => {
    expect(f.skills).toContain("Multi-Vendor & Multi-Partner Environments");
    expect(f.skills).toContain("Enterprise Programme Management");
  });

  it("keeps certifications whole rather than splitting on commas", () => {
    expect(f.certifications.some((c) => c.startsWith("TOGAF 10 Foundation"))).toBe(true);
    expect(f.certifications.some((c) => c.includes("APMG International"))).toBe(true);
  });

  it("separates the degree from the certifications", () => {
    expect(f.education).toHaveLength(1);
    expect(f.education[0].qualification).toContain("Bachelor of Commerce");
    // The degree must not also appear as a certification.
    expect(f.certifications.some((c) => c.includes("Bachelor of Commerce"))).toBe(false);
  });

  it("reads languages from their own section only", () => {
    expect(f.languages).toEqual(expect.arrayContaining(["English", "Afrikaans"]));
    expect(f.languages).not.toContain("Available upon request");
  });
});
