import { describe, it, expect } from "vitest";
import { fieldsFromExtraction, flagsFromExtraction, mergeExtractionIntoFields } from "@/app/(app)/candidates/cv-fields";
import { EMPTY_CANDIDATE } from "@/app/(app)/candidates/candidate-fields";
import { emptyExtractedFields, type ExtractionResult } from "@/lib/extraction/types";

function extraction(fields: Partial<ReturnType<typeof emptyExtractedFields>>): ExtractionResult {
  return {
    fields: { ...emptyExtractedFields(), ...fields },
    raw_text: "",
    engine: "local",
    no_text_found: false,
  };
}

const job = (company: string) => ({
  title: "Business Analyst",
  company,
  client: null,
  location: null,
  employment_type: null,
  start_date: "2020",
  end_date: null,
  is_current: true,
  description: "Did the work",
  achievements: null,
});

describe("fieldsFromExtraction", () => {
  it("carries every section the template has, and the system's defaults for the rest", () => {
    const r = extraction({
      full_name: "Thandi Example",
      availability: "notice_period",
      availability_note: "1 Calendar Month",
      date_of_birth: "05 February 1989",
      skill_matrix: [{ category: "Tools", skills: [{ name: "Jira", years: null }] }],
    });
    const f = fieldsFromExtraction(r);
    expect(f.full_name).toBe("Thandi Example");
    expect(f.availability).toBe("notice_period");
    expect(f.availability_note).toBe("1 Calendar Month");
    expect(f.date_of_birth).toBe("05 February 1989");
    expect(f.skill_matrix).toHaveLength(1);
    expect(f.status).toBe("active");
    expect(f.notes).toBeNull();
  });

  it("flags exactly what the document filled", () => {
    const flags = flagsFromExtraction(extraction({ full_name: "T", availability_note: "Immediately" }));
    expect(flags.full_name).toBe(true);
    expect(flags.availability_note).toBe(true);
    expect(flags.skill_matrix).toBe(false);
    expect(flags.email).toBe(false);
  });
});

describe("mergeExtractionIntoFields", () => {
  const existing = {
    ...EMPTY_CANDIDATE,
    full_name: "Thandi Example",
    status: "placed" as const,
    notes: "Interviewed in May",
    skills: ["Facilitation"],
    work_experience: [job("Old employer")],
    skill_matrix: [{ category: "Tools", skills: [{ name: "Visio", years: null }] }],
  };

  it("replaces the CV's sections rather than appending them, so an updated CV does not double the jobs", () => {
    const r = extraction({
      full_name: "Thandi Example",
      work_experience: [job("Old employer"), job("New employer")],
      skill_matrix: [{ category: "Tools", skills: [{ name: "Jira", years: "2 years" }] }],
      certificates: [{ name: "CBAP", institution: "IIBA", year: "2024" }],
    });
    const { fields, flags } = mergeExtractionIntoFields(existing, r);
    expect(fields.work_experience.map((w) => w.company)).toEqual(["Old employer", "New employer"]);
    expect(fields.skill_matrix[0].skills[0].name).toBe("Jira");
    expect(fields.certificates[0].name).toBe("CBAP");
    expect(flags.work_experience).toBe(true);
    expect(flags.certificates).toBe(true);
  });

  it("unions the matching lists and leaves the system's own fields alone", () => {
    const r = extraction({ skills: ["Stakeholder Management"], availability_note: "Immediately" });
    const { fields } = mergeExtractionIntoFields(existing, r);
    expect(fields.skills).toEqual(["Facilitation", "Stakeholder Management"]);
    expect(fields.status).toBe("placed");
    expect(fields.notes).toBe("Interviewed in May");
    expect(fields.availability_note).toBe("Immediately");
  });

  it("keeps what the new CV did not state", () => {
    const { fields, flags } = mergeExtractionIntoFields(existing, extraction({}));
    expect(fields.work_experience).toHaveLength(1);
    expect(fields.skill_matrix[0].skills[0].name).toBe("Visio");
    expect(fields.full_name).toBe("Thandi Example");
    expect(flags.work_experience).toBe(false);
  });
});
