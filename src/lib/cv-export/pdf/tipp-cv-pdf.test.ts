import { describe, it, expect } from "vitest";
import { getDocumentProxy } from "unpdf";
import { renderTippCvPdf, type CvPdfContext } from "@/lib/cv-export/pdf/tipp-cv-pdf";
import { lineKinds } from "@/lib/cv-record";
import { tablesFromPdfPages, pdfItemsFrom, type PdfPageItems } from "@/lib/extraction/pdf-tables";
import { parseTippTables } from "@/lib/extraction/tipp-tables";
import type { CvSource } from "@/lib/cv-export/missing-fields";

const CONTEXT: CvPdfContext = {
  manager: { name: "Samantha Example", email: "samantha@example.com", phone: "011 000 0000" },
  asOf: new Date("2026-09-12T08:00:00Z"),
  generatedBy: "Ofentse Seabi",
};

function candidate(overrides: Partial<CvSource> = {}): CvSource {
  return {
    full_name: "Nomsa Khumalo",
    current_role: "DevOps Engineer",
    designated_group: "African Female",
    languages: [],
    availability: "notice_period",
    availability_note: "1 Calendar Month",
    professional_summary: "Platform engineer with eight years running container platforms.\nShe has led three migrations.",
    skills: ["Kubernetes", "Terraform"],
    technical_skills: ["AWS"],
    certifications: ["Certified Kubernetes Administrator"],
    qualifications: [],
    education: [{ qualification: "BSc Computer Science", field: null, institution: "UCT", year: "2017" }],
    work_experience: [
      {
        title: "DevOps Engineer",
        company: "Takealot",
        client: "Internal Platform",
        location: null,
        employment_type: null,
        start_date: "May 2021",
        end_date: null,
        is_current: true,
        description: "• Owns the Kubernetes platform\nTeam leadership\n• Runs CI/CD tooling",
        achievements: null,
      },
      {
        title: "Systems Engineer",
        company: "AWS Cape Town",
        location: null,
        employment_type: null,
        start_date: "February 2018",
        end_date: "April 2021",
        is_current: false,
        description: "Infrastructure automation",
        achievements: null,
      },
    ],
    date_of_birth: "1989-02-05",
    years_experience: 8,
    skill_matrix: [
      { category: "Tools", skills: [{ name: "Terraform", years: "5+ years" }, { name: "Helm", years: "5+ years" }] },
      { category: "Software Platforms", skills: [{ name: "AWS", years: "8+ years" }, { name: "Azure", years: "2 years" }] },
    ],
    certificates: [{ name: "Certified Kubernetes Administrator", institution: "CNCF", year: "2022" }],
    projects: [{ company: "Takealot", projects: ["Platform migration", "Cost programme"] }],
    achievements: "Technical Proficiency\n• Operating System: Linux\n• Spread Sheet: Excel\nOther Achievements\n• Speaker at DevConf 2024",
    ...overrides,
  };
}

/** The PDF read back the way the app reads an uploaded one. */
async function readBack(buffer: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages: PdfPageItems[] = [];
  const text: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { items } = await page.getTextContent();
    pages.push({ items: pdfItemsFrom(items as unknown[]) });
    text.push((items as { str?: string }[]).map((i) => i.str ?? "").join(" "));
  }
  const result = tablesFromPdfPages(pages);
  const parsed = parseTippTables(result.tables);
  expect(parsed, "generated PDF was not recognised as the template").not.toBeNull();
  return { pages: pdf.numPages, coverAsOf: result.coverAsOf, hadCover: result.hadCover, parsed: parsed!, text: text.join("\n") };
}

describe("lineKinds", () => {
  it("makes marked lines bullets and unmarked lines sub-headings", () => {
    expect(lineKinds("Technical Proficiency\n• Linux\n• Excel")).toEqual([
      { kind: "heading", text: "Technical Proficiency" },
      { kind: "bullet", text: "Linux" },
      { kind: "bullet", text: "Excel" },
    ]);
  });

  it("makes every line a bullet when nothing is marked, which is how older records and the AI write them", () => {
    expect(lineKinds("Owns the platform\nRuns the tooling").map((l) => l.kind)).toEqual(["bullet", "bullet"]);
  });

  it("drops a client line, which has a row of its own", () => {
    expect(lineKinds("Client: Old Mutual\n• Did the work")).toEqual([{ kind: "bullet", text: "Did the work" }]);
  });
});

describe("renderTippCvPdf", () => {
  it("prints the cover page the reader recognises, with the date and the account manager", async () => {
    const { hadCover, coverAsOf, text, pages } = await readBack(await renderTippCvPdf(candidate(), CONTEXT));
    expect(hadCover).toBe(true);
    expect(coverAsOf).toBe("12 September 2026");
    expect(text).toContain("Samantha Example");
    expect(text).toContain("samantha@example.com");
    expect(text).toContain("Protection of Personal Information (POPI) compliance");
    expect(pages).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("reads back through the template reader with every section it was given", async () => {
    const { parsed } = await readBack(await renderTippCvPdf(candidate(), CONTEXT));
    expect(parsed.full_name).toBe("Nomsa Khumalo");
    expect(parsed.current_role).toBe("DevOps Engineer");
    expect(parsed.date_of_birth).toBe("05 February 1989");
    expect(parsed.designated_group).toBe("African Female");
    expect(parsed.years_experience).toBe(8);
    expect(parsed.availability_note).toBe("1 Calendar Month");
    expect(parsed.professional_summary).toContain("Platform engineer with eight years");
    expect(parsed.professional_summary).toContain("She has led three migrations.");
    expect(parsed.education).toEqual([{ qualification: "BSc Computer Science", field: null, institution: "UCT", year: "2017" }]);
    expect(parsed.certificates).toEqual([{ name: "Certified Kubernetes Administrator", institution: "CNCF", year: "2022" }]);
    expect(parsed.skill_matrix?.map((c) => c.category)).toEqual(["Tools", "Software Platforms"]);
    expect(parsed.skill_matrix?.[0].skills).toEqual([{ name: "Terraform", years: "5+ years" }, { name: "Helm", years: "5+ years" }]);
    expect(parsed.projects).toEqual([{ company: "Takealot", projects: ["Platform migration", "Cost programme"] }]);
    expect(parsed.achievements).toContain("Technical Proficiency");
    expect(parsed.achievements).toContain("• Speaker at DevConf 2024");
  }, 30_000);

  it("reproduces every job with its client, dates, sub-headings and bullets", async () => {
    const { parsed } = await readBack(await renderTippCvPdf(candidate(), CONTEXT));
    expect(parsed.work_experience).toHaveLength(2);
    const [first, second] = parsed.work_experience;
    expect(first.company).toBe("Takealot");
    expect(first.client).toBe("Internal Platform");
    expect(first.title).toBe("DevOps Engineer");
    expect(first.is_current).toBe(true);
    // The sub-heading came back without a bullet and the duties with theirs.
    expect(first.description).toBe("• Owns the Kubernetes platform\nTeam leadership\n• Runs CI/CD tooling");
    expect(second.company).toBe("AWS Cape Town");
    expect(second.client).toBeNull();
    expect(second.end_date).toBe("April 2021");
  }, 30_000);

  it("leaves out PROJECTS and ACHIEVEMENTS when the record has none, and never prints undefined", async () => {
    const { text, parsed } = await readBack(
      await renderTippCvPdf(candidate({ projects: [], achievements: null, designated_group: null }), CONTEXT),
    );
    expect(text).not.toMatch(/undefined/i);
    expect(text).not.toContain("PROJECTS");
    expect(text).not.toContain("ACHIEVEMENTS");
    expect(parsed.projects).toEqual([]);
    expect(parsed.achievements).toBeNull();
    expect(parsed.designated_group).toBeNull();
  }, 30_000);
});
