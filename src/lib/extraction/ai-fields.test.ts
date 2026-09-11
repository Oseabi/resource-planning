import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  stripPii,
  truncateForAi,
  AI_INPUT_CHAR_CAP,
  CV_SCHEMA,
  isStrictSchema,
  buildPrompt,
  coerceAiFields,
  mergeExtraction,
} from "@/lib/extraction/ai-fields";
import { emptyExtractedFields, type ExtractedCandidateFields } from "@/lib/extraction/types";
import { isTippCv } from "@/lib/extraction/local-parser";

describe("stripPii", () => {
  it("removes an email address", () => {
    expect(stripPii("Contact: nomsa.k@tippfocus.co.za please")).toBe(
      "Contact: [email removed] please",
    );
  });

  it("removes every South African phone shape a CV uses", () => {
    const shapes = [
      "+27 82 123 4567",
      "082 123 4567",
      "(012) 345 6789",
      "082-123-4567",
      "0821234567",
      "+27821234567",
    ];
    for (const s of shapes) {
      expect(stripPii(`Cell: ${s}.`), s).toBe("Cell: [phone removed].");
    }
  });

  it("removes a thirteen digit ID number", () => {
    expect(stripPii("ID 8501015800083 issued")).toBe("ID [id number removed] issued");
  });

  it("leaves years, amounts and dates alone", () => {
    // The whole point of anchoring on non-digits. A CV is full of numbers
    // that are not contact details, and losing them would cost the model the
    // dates it needs to read work history.
    const control = "Joined in 2019, budget R12 500 000, from 01/03/2021 to 2023-12-31, 15 years";
    expect(stripPii(control)).toBe(control);
  });

  it("leaves a phone number inside an ID-length run alone, since it is not one", () => {
    // Fourteen digits is neither a phone nor an ID.
    expect(stripPii("ref 12345678901234")).toBe("ref 12345678901234");
  });

  it("removes a date of birth line, however it is labelled", () => {
    expect(stripPii("Date of Birth: 12 March 1985\nNationality: South African")).toBe(
      "[date of birth removed]\nNationality: South African",
    );
    expect(stripPii("DOB 1985-03-12 | Gender: F")).toBe("[date of birth removed]");
  });

  it("replaces rather than deletes, so the sentence still reads", () => {
    const out = stripPii("Reach me on 082 123 4567 or nomsa@example.com any time.");
    expect(out).toBe("Reach me on [phone removed] or [email removed] any time.");
  });
});

describe("truncateForAi", () => {
  it("passes a short text through untouched", () => {
    expect(truncateForAi("short")).toEqual({ text: "short", truncated: false });
  });

  it("passes a text exactly at the cap through untouched", () => {
    const text = "x".repeat(AI_INPUT_CHAR_CAP);
    expect(truncateForAi(text).truncated).toBe(false);
  });

  it("cuts a long text and says so", () => {
    const text = "x".repeat(AI_INPUT_CHAR_CAP + 1);
    const out = truncateForAi(text);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(AI_INPUT_CHAR_CAP);
  });

  it("cuts at a line break so the model does not read a torn sentence", () => {
    const line = "a line of a CV that is about forty chars\n";
    const text = line.repeat(400);
    const out = truncateForAi(text);
    expect(out.truncated).toBe(true);
    expect(out.text.endsWith("chars")).toBe(true);
  });

  it("does not throw away half the text to find a line break", () => {
    // One enormous line with no breaks: cut at the cap rather than at nothing.
    const text = "x".repeat(AI_INPUT_CHAR_CAP * 2);
    expect(truncateForAi(text).text).toHaveLength(AI_INPUT_CHAR_CAP);
  });
});

describe("CV_SCHEMA", () => {
  it("satisfies Groq's strict mode", () => {
    expect(isStrictSchema(CV_SCHEMA)).toEqual([]);
  });

  it("does not ask for anything that was stripped", () => {
    // The contact fields come from the local parser. Asking the model for
    // them after removing them from the text would invite it to invent one.
    for (const forbidden of ["full_name", "email", "phone", "linkedin_url", "portfolio_url"]) {
      expect(Object.keys(CV_SCHEMA.properties)).not.toContain(forbidden);
    }
  });

  it("lists every field of a work experience entry, since strict mode requires it", () => {
    const item = CV_SCHEMA.properties.work_experience.items;
    expect([...item.required].sort()).toEqual(
      [
        "title",
        "company",
        "location",
        "employment_type",
        "start_date",
        "end_date",
        "is_current",
        "description",
        "achievements",
      ].sort(),
    );
  });
});

describe("isStrictSchema", () => {
  it("catches a property left out of required", () => {
    const bad = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { type: "string" }, b: { type: "string" } },
    };
    expect(isStrictSchema(bad)).toEqual(["$.b: not listed in required"]);
  });

  it("catches an object that allows extra properties", () => {
    const bad = { type: "object", required: [], properties: {} };
    expect(isStrictSchema(bad)).toEqual(["$: additionalProperties must be false"]);
  });

  it("catches a required name with no definition", () => {
    const bad = { type: "object", additionalProperties: false, required: ["ghost"], properties: {} };
    expect(isStrictSchema(bad)).toEqual(["$.ghost: required but not defined"]);
  });

  it("walks into array items", () => {
    const bad = {
      type: "object",
      additionalProperties: false,
      required: ["list"],
      properties: {
        list: { type: "array", items: { type: "object", required: [], properties: {} } },
      },
    };
    expect(isStrictSchema(bad)).toEqual(["$.list[]: additionalProperties must be false"]);
  });
});

describe("buildPrompt", () => {
  it("carries the exact role spellings matching scores on", () => {
    const prompt = buildPrompt("cv text");
    expect(prompt).toContain("Business Analyst");
    expect(prompt).toContain("Project Manager");
  });

  it("puts the CV at the end, after every instruction", () => {
    const prompt = buildPrompt("THE CV BODY");
    expect(prompt.endsWith("THE CV BODY")).toBe(true);
  });

  it("tells the model not to guess", () => {
    expect(buildPrompt("x")).toMatch(/Never guess/);
  });
});

describe("coerceAiFields", () => {
  it("reads a well-formed answer", () => {
    const out = coerceAiFields({
      current_role: " Business Analyst ",
      additional_roles: ["Scrum Master"],
      years_experience: 7.4,
      professional_summary: "Seven years in public sector delivery.",
      skills: ["Stakeholder management", "Requirements elicitation"],
      technical_skills: ["SQL", "Power BI"],
      certifications: ["PMP"],
      qualifications: ["BCom Informatics"],
      sectors: ["Public Sector"],
      languages: ["English", "isiZulu"],
      designated_group: "African",
      availability: "notice_period",
      work_experience: [
        {
          title: "Senior BA",
          company: "SITA",
          location: "Pretoria",
          employment_type: "Permanent",
          start_date: "2019-03",
          end_date: null,
          is_current: true,
          description: "ERP programme",
          achievements: null,
        },
      ],
      education: [{ qualification: "BCom", field: "Informatics", institution: "UP", year: "2016" }],
    });
    expect(out.current_role).toBe("Business Analyst");
    expect(out.years_experience).toBe(7.5);
    expect(out.availability).toBe("notice_period");
    expect(out.work_experience[0].is_current).toBe(true);
    expect(out.education[0].institution).toBe("UP");
  });

  it("returns empty values for an empty object rather than throwing", () => {
    const out = coerceAiFields({});
    expect(out.current_role).toBeNull();
    expect(out.skills).toEqual([]);
    expect(out.work_experience).toEqual([]);
    expect(out.availability).toBeUndefined();
  });

  it("returns empty values for garbage rather than throwing", () => {
    expect(() => coerceAiFields(null)).not.toThrow();
    expect(() => coerceAiFields("not an object")).not.toThrow();
    expect(() => coerceAiFields(42)).not.toThrow();
    expect(coerceAiFields([]).skills).toEqual([]);
  });

  it("drops wrong types in every field", () => {
    const out = coerceAiFields({
      current_role: 42,
      additional_roles: "not a list",
      years_experience: "seven",
      skills: [1, 2, null, ""],
      availability: 3,
      work_experience: "nope",
      education: [null, "x", {}],
    });
    expect(out.current_role).toBeNull();
    expect(out.additional_roles).toEqual([]);
    expect(out.years_experience).toBeNull();
    expect(out.skills).toEqual([]);
    expect(out.availability).toBeUndefined();
    expect(out.work_experience).toEqual([]);
    expect(out.education).toEqual([]);
  });

  it("drops an availability value it does not know rather than storing it", () => {
    expect(coerceAiFields({ availability: "immediately" }).availability).toBeUndefined();
    expect(coerceAiFields({ availability: null }).availability).toBeUndefined();
  });

  it("deduplicates a list without caring about case", () => {
    expect(coerceAiFields({ skills: ["SQL", "sql", " SQL "] }).skills).toEqual(["SQL"]);
  });

  it("clamps years to something a person can have", () => {
    expect(coerceAiFields({ years_experience: -3 }).years_experience).toBeNull();
    expect(coerceAiFields({ years_experience: 150 }).years_experience).toBeNull();
    expect(coerceAiFields({ years_experience: "12" }).years_experience).toBe(12);
  });

  it("keeps a job with only a company, and drops one with neither", () => {
    const out = coerceAiFields({
      work_experience: [
        { company: "SITA" },
        { title: null, company: null, description: "orphan" },
      ],
    });
    expect(out.work_experience).toHaveLength(1);
    expect(out.work_experience[0].company).toBe("SITA");
  });

  it("drops an education entry with no qualification", () => {
    const out = coerceAiFields({ education: [{ institution: "UP" }, { qualification: "BSc" }] });
    expect(out.education.map((e) => e.qualification)).toEqual(["BSc"]);
  });
});

describe("mergeExtraction", () => {
  const local: ExtractedCandidateFields = {
    ...emptyExtractedFields(),
    full_name: "Nomsa Khumalo",
    email: "nomsa@example.com",
    phone: "082 123 4567",
    linkedin_url: "https://linkedin.com/in/nomsa",
    current_role: "Analyst",
    skills: ["Excel"],
    technical_skills: ["SQL"],
    years_experience: 5,
  };

  const ai = coerceAiFields({
    current_role: "Business Analyst",
    skills: ["Stakeholder management"],
    technical_skills: [],
    years_experience: 7,
    work_experience: [{ title: "Senior BA", company: "SITA", is_current: true }],
    availability: "available",
  });

  it("keeps identity and contact from the local parser", () => {
    // The model never saw them, so anything it returned would be invented.
    const out = mergeExtraction(local, ai);
    expect(out.full_name).toBe("Nomsa Khumalo");
    expect(out.email).toBe("nomsa@example.com");
    expect(out.phone).toBe("082 123 4567");
    expect(out.linkedin_url).toBe("https://linkedin.com/in/nomsa");
  });

  it("takes the model's answer for semantic fields", () => {
    const out = mergeExtraction(local, ai);
    expect(out.current_role).toBe("Business Analyst");
    expect(out.years_experience).toBe(7);
    expect(out.skills).toEqual(["Stakeholder management"]);
    expect(out.work_experience).toHaveLength(1);
    expect(out.availability).toBe("available");
  });

  it("keeps a local list the model left empty", () => {
    // The dictionary caught SQL and the model did not. Still a skill.
    expect(mergeExtraction(local, ai).technical_skills).toEqual(["SQL"]);
  });

  it("does not resurrect a local scalar the model replaced", () => {
    expect(mergeExtraction(local, ai).current_role).not.toBe("Analyst");
  });

  it("falls back to the local scalar when the model returned null", () => {
    const quiet = coerceAiFields({});
    const out = mergeExtraction(local, quiet);
    expect(out.current_role).toBe("Analyst");
    expect(out.years_experience).toBe(5);
  });

  it("leaves availability alone when the model did not say", () => {
    const quiet = coerceAiFields({});
    expect(mergeExtraction(local, quiet).availability).toBeUndefined();
  });

  it("does not mutate the local result", () => {
    const before = JSON.stringify(local);
    mergeExtraction(local, ai);
    expect(JSON.stringify(local)).toBe(before);
  });
});

describe("isTippCv, the gate on what leaves the building", () => {
  const read = (name: string) =>
    fs.readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

  it("recognises every TiPP fixture, so none of them is ever sent", () => {
    for (const name of ["tipp-cv-bongani.txt", "tipp-cv-godfrey.txt", "tipp-cv-thamsanqa.txt"]) {
      expect(isTippCv(read(name)), name).toBe(true);
    }
  });

  it("does not recognise a generic CV, so that one can be", () => {
    expect(isTippCv(read("executive-cv.txt"))).toBe(false);
  });

  it("does not recognise nothing", () => {
    expect(isTippCv("")).toBe(false);
  });
});
