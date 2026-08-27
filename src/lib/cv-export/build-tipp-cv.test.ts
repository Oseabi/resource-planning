import { describe, it, expect } from "vitest";
import mammoth from "mammoth";
import {
  buildTippCv,
  toTemplateData,
  missingTemplateFields,
  cvFilename,
  type CvSource,
} from "@/lib/cv-export/build-tipp-cv";
import { parseTippTemplate } from "@/lib/extraction/tipp-template";

function candidate(overrides: Partial<CvSource> = {}): CvSource {
  return {
    full_name: "Nomsa Khumalo",
    current_role: "DevOps Engineer",
    designated_group: "African Female",
    languages: ["English", "isiZulu"],
    availability: "notice_period",
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
        location: null,
        employment_type: null,
        start_date: "May 2021",
        end_date: null,
        is_current: true,
        description: "Client: Internal Platform\nOwns the Kubernetes platform\nRuns CI/CD tooling",
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
    ...overrides,
  };
}

describe("toTemplateData", () => {
  it("writes an open-ended job as Current rather than leaving it blank", () => {
    const data = toTemplateData(candidate());
    expect(data.career[0].duration).toBe("May 2021 - Current");
    expect(data.career[1].duration).toBe("February 2018 - April 2021");
  });

  it("puts the client on its own row and keeps it out of the duties", () => {
    const [first] = toTemplateData(candidate()).employment;
    expect(first.client).toBe("Internal Platform");
    expect(first.has_client).toEqual(["Internal Platform"]);
    // The template has a Client row, so repeating it as a duty prints it twice.
    expect(first.duties).toEqual(["Owns the Kubernetes platform", "Runs CI/CD tooling"]);
  });

  it("omits the client row entirely when there is no client", () => {
    const [, second] = toTemplateData(candidate()).employment;
    expect(second.has_client).toEqual([]);
    expect(second.duties).toEqual(["Infrastructure automation"]);
  });

  it("writes availability as a person would say it, not as the enum", () => {
    expect(toTemplateData(candidate({ availability: "available" })).availability).toBe(
      "Immediately Available",
    );
    expect(toTemplateData(candidate()).availability).toBe("On notice");
  });

  it("merges professional and technical skills, since the CV has one block", () => {
    expect(toTemplateData(candidate()).skills).toEqual(["Kubernetes", "Terraform", "AWS"]);
  });

  it("falls back to bare qualification strings when there is no structured education", () => {
    const data = toTemplateData(
      candidate({ education: [], qualifications: ["National Diploma in IT"] }),
    );
    expect(data.education).toEqual([
      { qualification: "National Diploma in IT", institution: "", year: "" },
    ]);
  });
});

describe("missingTemplateFields", () => {
  it("reports nothing for a complete record", () => {
    expect(missingTemplateFields(candidate())).toEqual([]);
  });

  it("names the fields the template has a row for", () => {
    const missing = missingTemplateFields(
      candidate({
        designated_group: null,
        languages: [],
        availability: null,
        professional_summary: null,
      }),
    );
    expect(missing).toEqual([
      "Designated group",
      "Languages",
      "Availability",
      "Candidate summary",
    ]);
  });

  it("accepts either structured education or bare qualifications", () => {
    const withBare = candidate({ education: [], qualifications: ["Matric"] });
    expect(missingTemplateFields(withBare)).not.toContain("Qualifications");

    const withNeither = candidate({ education: [], qualifications: [] });
    expect(missingTemplateFields(withNeither)).toContain("Qualifications");
  });
});

describe("cvFilename", () => {
  it("is safe to drop in a bid folder", () => {
    expect(cvFilename("Nomsa Khumalo")).toBe("TippFocus - Nomsa Khumalo.docx");
    expect(cvFilename("Dr Ayanda Cele (PhD)")).toBe("TippFocus - Dr Ayanda Cele PhD.docx");
    expect(cvFilename("")).toBe("TippFocus - candidate.docx");
  });
});

/**
 * The round trip is the test that matters.
 *
 * Generating a document and eyeballing it proves very little: a value written
 * into the wrong cell still looks like a filled-in CV. Feeding the output back
 * through the parser that reads this template checks every field landed where
 * the template says it should, and fails loudly when one does not.
 */
describe("round trip: generate, then read back with the template parser", () => {
  it("returns every field it was given", async () => {
    const source = candidate();
    const buffer = buildTippCv(source);
    expect(buffer.length).toBeGreaterThan(10_000);

    const { value: text } = await mammoth.extractRawText({ buffer });
    const parsed = parseTippTemplate(text);

    expect(parsed, "generated document was not recognised as the template").not.toBeNull();

    expect(parsed!.full_name).toBe("Nomsa Khumalo");
    expect(parsed!.current_role).toBe("DevOps Engineer");
    expect(parsed!.languages).toEqual(["English", "isiZulu"]);
    expect(parsed!.availability).toBe("notice_period");
    expect(parsed!.professional_summary).toContain("Platform engineer");
    expect(parsed!.certifications).toEqual(["Certified Kubernetes Administrator"]);
    expect(parsed!.education).toEqual([
      { qualification: "BSc Computer Science", field: null, institution: "UCT", year: "2017" },
    ]);
    expect(parsed!.skills).toEqual(["Kubernetes", "Terraform", "AWS"]);
  });

  it("reproduces every job, with its company, title and dates", async () => {
    const buffer = buildTippCv(candidate());
    const { value: text } = await mammoth.extractRawText({ buffer });
    const parsed = parseTippTemplate(text)!;

    expect(parsed.work_experience).toHaveLength(2);

    const [first, second] = parsed.work_experience;
    expect(first.company).toBe("Takealot");
    expect(first.title).toBe("DevOps Engineer");
    expect(first.is_current).toBe(true);
    expect(first.description).toContain("Client: Internal Platform");
    expect(first.description).toContain("Owns the Kubernetes platform");

    expect(second.company).toBe("AWS Cape Town");
    expect(second.end_date).toBe("April 2021");
    expect(second.is_current).toBe(false);
  });

  it("leaves a missing field blank instead of writing undefined into the document", async () => {
    const buffer = buildTippCv(candidate({ designated_group: null }));
    const { value: text } = await mammoth.extractRawText({ buffer });

    expect(text).not.toMatch(/undefined/i);
    expect(text).toContain("DESIGNATED GROUP");
  });
});
