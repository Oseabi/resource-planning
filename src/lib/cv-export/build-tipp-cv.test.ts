import { describe, it, expect } from "vitest";
import mammoth from "mammoth";
import PizZip from "pizzip";
import {
  buildTippCv,
  toTemplateData,
  missingTemplateFields,
  cvFilename,
  type CvSource,
  type CvContext,
} from "@/lib/cv-export/build-tipp-cv";
import { tablesFromHtml } from "@/lib/extraction/docx-tables";
import { parseTippTables } from "@/lib/extraction/tipp-tables";

const CONTEXT: CvContext = {
  manager: { name: "Samantha Example", email: "samantha@example.com", phone: "011 000 0000" },
  asOf: new Date("2026-09-12T08:00:00Z"),
  generatedBy: "Ofentse Seabi",
};

function candidate(overrides: Partial<CvSource> = {}): CvSource {
  return {
    full_name: "Nomsa Khumalo",
    current_role: "DevOps Engineer",
    designated_group: "African Female",
    languages: ["English", "isiZulu"],
    availability: "notice_period",
    availability_note: "1 Calendar Month",
    professional_summary: "Platform engineer with eight years running container platforms.",
    skills: ["Kubernetes", "Terraform"],
    technical_skills: ["AWS"],
    certifications: ["Certified Kubernetes Administrator"],
    qualifications: [],
    education: [
      { qualification: "BSc Computer Science", field: null, institution: "UCT", year: "2017" },
    ],
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
        description: "Owns the Kubernetes platform\nRuns CI/CD tooling",
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
    achievements: "Speaker at DevConf 2024",
    ...overrides,
  };
}

describe("toTemplateData", () => {
  it("writes an open-ended job as Current rather than leaving it blank", () => {
    const data = toTemplateData(candidate(), CONTEXT);
    expect(data.career[0].duration).toBe("May 2021 - Current");
    expect(data.career[1].duration).toBe("February 2018 - April 2021");
  });

  it("puts the client on its own row, from the field", () => {
    const [first, second] = toTemplateData(candidate(), CONTEXT).employment;
    expect(first.client).toBe("Internal Platform");
    expect(first.has_client).toEqual(["Internal Platform"]);
    expect(first.duties).toEqual(["Owns the Kubernetes platform", "Runs CI/CD tooling"]);
    expect(second.has_client).toEqual([]);
  });

  it("prints the CV's own availability words, and the status label without them", () => {
    expect(toTemplateData(candidate(), CONTEXT).availability).toBe("1 Calendar Month");
    expect(toTemplateData(candidate({ availability_note: null }), CONTEXT).availability).toBe("On notice");
    expect(toTemplateData(candidate({ availability_note: null, availability: "available" }), CONTEXT).availability).toBe(
      "Immediately Available",
    );
  });

  it("fills the cover page from the context, not from the candidate", () => {
    const data = toTemplateData(candidate(), CONTEXT);
    expect(data.as_of_date).toBe("12 September 2026");
    expect(data.manager_name).toBe("Samantha Example");
    expect(data.manager_email).toBe("samantha@example.com");
    expect(data.manager_phone).toBe("011 000 0000");
  });

  it("prints the header dates and years the way the template writes them", () => {
    const data = toTemplateData(candidate(), CONTEXT);
    expect(data.date_of_birth).toBe("05 February 1989");
    expect(data.years_experience).toBe("8 years");
    expect(toTemplateData(candidate({ years_experience: 14.5 }), CONTEXT).years_experience).toBe("14+ years");
    // The review screen sends the template's own words; they print as they are.
    expect(toTemplateData(candidate({ date_of_birth: "5 Feb 1989" }), CONTEXT).date_of_birth).toBe("05 February 1989");
    expect(toTemplateData(candidate({ date_of_birth: null, years_experience: null }), CONTEXT).date_of_birth).toBe("");
  });

  it("writes a skillset row's years once when its skills agree, and beside each when they differ", () => {
    const { skillset } = toTemplateData(candidate(), CONTEXT);
    expect(skillset[0]).toEqual({ category: "Tools", skills: "Terraform; Helm", years: "5+ years" });
    expect(skillset[1]).toEqual({ category: "Software Platforms", skills: "AWS (8+ years); Azure (2 years)", years: "" });
  });

  it("makes one skillset row from the flat lists when a record has no table", () => {
    const { skillset } = toTemplateData(candidate({ skill_matrix: [] }), CONTEXT);
    expect(skillset).toEqual([{ category: "Skills", skills: "AWS; Kubernetes; Terraform", years: "" }]);
  });

  it("prints certificates with their institution and year, falling back to bare names", () => {
    expect(toTemplateData(candidate(), CONTEXT).certificates).toEqual([
      { qualification: "Certified Kubernetes Administrator", institution: "CNCF", year: "2022" },
    ]);
    expect(toTemplateData(candidate({ certificates: [] }), CONTEXT).certificates).toEqual([
      { qualification: "Certified Kubernetes Administrator", institution: "", year: "" },
    ]);
  });

  it("switches the optional sections on only when there is something to print", () => {
    const full = toTemplateData(candidate(), CONTEXT);
    expect(full.has_projects).toEqual([true]);
    expect(full.projects).toEqual([{ company: "Takealot", names: "Platform migration\nCost programme" }]);
    expect(full.has_achievements).toEqual([true]);

    const bare = toTemplateData(candidate({ projects: [], achievements: "  " }), CONTEXT);
    expect(bare.has_projects).toEqual([]);
    expect(bare.has_achievements).toEqual([]);
  });

  it("falls back to bare qualification strings when there is no structured education", () => {
    const data = toTemplateData(candidate({ education: [], qualifications: ["National Diploma in IT"] }), CONTEXT);
    expect(data.education).toEqual([{ qualification: "National Diploma in IT", institution: "", year: "" }]);
  });
});

describe("missingTemplateFields", () => {
  it("reports nothing for a complete record", () => {
    expect(missingTemplateFields(candidate())).toEqual([]);
  });

  it("names the rows the issued template always prints", () => {
    const missing = missingTemplateFields(
      candidate({
        date_of_birth: null,
        designated_group: null,
        years_experience: null,
        availability: null,
        availability_note: null,
        professional_summary: null,
      }),
    );
    expect(missing).toEqual([
      "Date of birth",
      "Designated group",
      "Years of experience",
      "Availability",
      "Candidate overview",
    ]);
  });

  it("does not warn about the sections the template prints only when the CV had them", () => {
    const missing = missingTemplateFields(candidate({ projects: [], achievements: null, certificates: [], certifications: [], languages: [] }));
    expect(missing).toEqual([]);
  });

  it("accepts either structured education or bare qualifications, and either skills shape", () => {
    expect(missingTemplateFields(candidate({ education: [], qualifications: ["Matric"] }))).not.toContain("Qualifications");
    expect(missingTemplateFields(candidate({ education: [], qualifications: [] }))).toContain("Qualifications");
    expect(missingTemplateFields(candidate({ skill_matrix: [] }))).not.toContain("Skillset");
    expect(missingTemplateFields(candidate({ skill_matrix: [], skills: [], technical_skills: [] }))).toContain("Skillset");
  });
});

describe("the built template", () => {
  it("prints nothing in white, and prints the achievements left-aligned", () => {
    // The source's empty OTHER ACHIEVEMENTS cell carries a white, centred
    // paragraph mark. A template built from it once rendered every
    // achievement invisible, which no text-level check can see.
    const zip = new PizZip(buildTippCv(candidate(), CONTEXT));
    const xml = zip.file("word/document.xml")!.asText();
    const cells = xml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
    const withText = cells.filter((c) => /<w:t[^>]*>[^<]+<\/w:t>/.test(c));
    expect(withText.length).toBeGreaterThan(10);
    for (const cell of withText) {
      expect(cell).not.toContain('w:color w:val="FFFFFF"');
    }
    const achievements = withText.find((c) => c.includes("Speaker at DevConf 2024"))!;
    expect(achievements).toContain('<w:jc w:val="left"/>');
  });
});

describe("cvFilename", () => {
  it("is safe to drop in a bid folder", () => {
    expect(cvFilename("Nomsa Khumalo")).toBe("TippFocus - Nomsa Khumalo.pdf");
    expect(cvFilename("Nomsa Khumalo", "docx")).toBe("TippFocus - Nomsa Khumalo.docx");
    expect(cvFilename("Dr Ayanda Cele (PhD)")).toBe("TippFocus - Dr Ayanda Cele PhD.pdf");
    expect(cvFilename("")).toBe("TippFocus - candidate.pdf");
  });
});

/**
 * The round trip is the test that matters.
 *
 * Generating a document and eyeballing it proves very little: a value written
 * into the wrong cell still looks like a filled-in CV. Feeding the output back
 * through the reader that reads this template, the same tables path the app
 * uses for a .docx, checks every field landed where the template says it
 * should, and fails loudly when one does not.
 */
async function readBack(source: CvSource) {
  const buffer = buildTippCv(source, CONTEXT);
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const { value: text } = await mammoth.extractRawText({ buffer });
  const parsed = parseTippTables(tablesFromHtml(html));
  expect(parsed, "generated document was not recognised as the template").not.toBeNull();
  return { buffer, text, parsed: parsed! };
}

describe("round trip: generate, then read back with the template reader", () => {
  it("returns every header field, the summary and the tables it was given", async () => {
    const { parsed, buffer } = await readBack(candidate());
    expect(buffer.length).toBeGreaterThan(10_000);

    expect(parsed.full_name).toBe("Nomsa Khumalo");
    expect(parsed.current_role).toBe("DevOps Engineer");
    expect(parsed.date_of_birth).toBe("05 February 1989");
    expect(parsed.designated_group).toBe("African Female");
    expect(parsed.years_experience).toBe(8);
    expect(parsed.availability).toBe("notice_period");
    expect(parsed.availability_note).toBe("1 Calendar Month");
    expect(parsed.professional_summary).toContain("Platform engineer");
    expect(parsed.education).toEqual([
      { qualification: "BSc Computer Science", field: null, institution: "UCT", year: "2017" },
    ]);
    expect(parsed.certificates).toEqual([
      { name: "Certified Kubernetes Administrator", institution: "CNCF", year: "2022" },
    ]);
    expect(parsed.skill_matrix).toEqual([
      { category: "Tools", skills: [{ name: "Terraform", years: "5+ years" }, { name: "Helm", years: "5+ years" }] },
      {
        category: "Software Platforms",
        skills: [
          { name: "AWS (8+ years)", years: null },
          { name: "Azure (2 years)", years: null },
        ],
      },
    ]);
    expect(parsed.projects).toEqual([{ company: "Takealot", projects: ["Platform migration", "Cost programme"] }]);
    expect(parsed.achievements).toBe("Speaker at DevConf 2024");
  });

  it("reproduces every job, with its company, client, title, dates and duties", async () => {
    const { parsed } = await readBack(candidate());
    expect(parsed.work_experience).toHaveLength(2);

    const [first, second] = parsed.work_experience;
    expect(first.company).toBe("Takealot");
    expect(first.client).toBe("Internal Platform");
    expect(first.title).toBe("DevOps Engineer");
    expect(first.is_current).toBe(true);
    // Every duty is a bullet on the generated CV, and the reader says so.
    expect(first.description).toBe("• Owns the Kubernetes platform\n• Runs CI/CD tooling");

    expect(second.company).toBe("AWS Cape Town");
    expect(second.client).toBeNull();
    expect(second.end_date).toBe("April 2021");
    expect(second.is_current).toBe(false);
  });

  it("prints the cover page with the date and the account manager, and names the generator in the file", async () => {
    const { text, buffer } = await readBack(candidate());
    expect(text).toContain("Candidate Resume");
    expect(text).toContain("As of date:\t12 September 2026");
    expect(text).toContain("Account Manager:\tSamantha Example");
    expect(text).toContain("samantha@example.com");
    expect(text).toContain("Protection of Personal Information (POPI) compliance");

    const core = new PizZip(buffer).file("docProps/core.xml")!.asText();
    expect(core).toContain("<dc:creator>Ofentse Seabi</dc:creator>");
    expect(core).toContain("2026-09-12T08:00:00Z");
    expect(core).not.toContain("brenda");
  });

  it("leaves out PROJECTS and ACHIEVEMENTS when the record has none, and never prints undefined", async () => {
    const { text, parsed } = await readBack(candidate({ projects: [], achievements: null, designated_group: null }));
    expect(text).not.toMatch(/undefined/i);
    expect(text).not.toContain("PROJECTS");
    expect(text).not.toContain("ACHIEVEMENTS");
    expect(text).toContain("DESIGNATED GROUP");
    expect(parsed.projects).toEqual([]);
    expect(parsed.achievements).toBeNull();
  });
});
