import { describe, it, expect } from "vitest";
import {
  extractEmail,
  extractPhone,
  matchDictionary,
  guessName,
  guessRole,
  guessExperienceYears,
  parseExperience,
} from "@/lib/extraction/heuristics";
import { parseTextToFields } from "@/lib/extraction/local-parser";
import { ALL_ROLES } from "@/lib/vocabulary";

const SAMPLE_CV = `ALEXANDER CHEN, P.E., S.E.
Senior Structural Engineer
123 Oak Street, London, UK | alexander.chen@example.com | +44 7911 123456

Professional Summary
Experienced Senior Structural Engineer with 12 years specialising in complex,
high-rise, and seismic retrofit projects. Expertise in Revit, Tekla Structures,
ETABS, and AutoCAD Civil 3D.

Skills
Structural Analysis, Seismic Design, BIM Coordination, Revit, AutoCAD Civil 3D

Certifications
CSCS Gold, SMSTS, NEBOSH

Education
BEng Civil Engineering (First Class Honours) - University of Manchester (2015)

Sectors
Construction, Commercial Infrastructure
`;

describe("extractEmail", () => {
  it("finds the email address", () => {
    expect(extractEmail(SAMPLE_CV)).toBe("alexander.chen@example.com");
  });
  it("returns null when absent", () => {
    expect(extractEmail("no contact details here")).toBeNull();
  });
});

describe("extractPhone", () => {
  it("finds an international phone number", () => {
    expect(extractPhone(SAMPLE_CV)).toContain("44 7911 123456");
  });
  it("finds a South African style number", () => {
    expect(extractPhone("Call me on 082 123 4567")).toContain("082 123 4567");
  });
  it("does not treat a lone year as a phone number", () => {
    expect(extractPhone("Graduated in 2015")).toBeNull();
  });
});

describe("matchDictionary", () => {
  it("tags known skills present in the text", () => {
    const skills = matchDictionary(SAMPLE_CV, ["Revit", "Tekla Structures", "AutoCAD", "SolidWorks"]);
    expect(skills).toContain("Revit");
    expect(skills).toContain("Tekla Structures");
    expect(skills).not.toContain("SolidWorks");
  });

  it("subsumes shorter matches inside longer ones", () => {
    // Both "CSCS" and "CSCS Gold" are dictionary terms; only the specific one survives.
    const certs = matchDictionary("Holds CSCS Gold card", ["CSCS", "CSCS Gold"]);
    expect(certs).toEqual(["CSCS Gold"]);
  });

  it("respects word boundaries", () => {
    expect(matchDictionary("Revitalise the process", ["Revit"])).toEqual([]);
  });
});

describe("guessName", () => {
  it("reads the name from the top line, dropping suffixes", () => {
    expect(guessName(SAMPLE_CV)).toBe("Alexander Chen");
  });

  it("falls back to the filename when no name line is found", () => {
    expect(guessName("2015 - 2019 project work", "james_carter_cv.pdf")).toBe("James Carter");
  });

  it("returns null when neither text nor filename yields a name", () => {
    expect(guessName("2015 2019", "document_final_v2.pdf")).toBeNull();
  });
});

describe("guessRole", () => {
  it("returns the most specific matching role", () => {
    expect(guessRole(SAMPLE_CV, ALL_ROLES)).toBe("Senior Structural Engineer");
  });
  it("returns null when no known role appears", () => {
    expect(guessRole("A pastry baker", ALL_ROLES)).toBeNull();
  });
});

describe("guessExperienceYears", () => {
  it("extracts the largest years figure", () => {
    expect(guessExperienceYears(SAMPLE_CV)).toBe(12);
  });
  it("handles the N+ years pattern", () => {
    expect(guessExperienceYears("Over 8+ years of experience")).toBe(8);
  });
  it("returns null when no figure present", () => {
    expect(guessExperienceYears("recent graduate")).toBeNull();
  });
});

describe("parseTextToFields (integration)", () => {
  it("assembles a full candidate record from a sample CV", () => {
    const fields = parseTextToFields(SAMPLE_CV, "alexander_chen_cv.pdf");
    expect(fields.full_name).toBe("Alexander Chen");
    expect(fields.email).toBe("alexander.chen@example.com");
    expect(fields.phone).toContain("44 7911 123456");
    expect(fields.current_role).toBe("Senior Structural Engineer");
    expect(fields.years_experience).toBe(12);
    // Revit / Tekla are technical skills; Structural Analysis is professional.
    expect(fields.technical_skills).toContain("Revit");
    expect(fields.technical_skills).toContain("Tekla Structures");
    expect(fields.skills).toContain("Structural Analysis");
    expect(fields.certifications).toContain("CSCS Gold");
    expect(fields.certifications).toContain("SMSTS");
    expect(fields.qualifications).toContain("BEng Civil Engineering");
    expect(fields.sectors).toContain("Construction");
  });

  it("degrades gracefully on text with no recognisable fields", () => {
    const fields = parseTextToFields("Lorem ipsum dolor sit amet.", undefined);
    expect(fields.email).toBeNull();
    expect(fields.phone).toBeNull();
    expect(fields.skills).toEqual([]);
    expect(fields.technical_skills).toEqual([]);
    expect(fields.certifications).toEqual([]);
  });
});

/**
 * Employment written with no dates, which is common on early-career CVs and
 * previously produced an empty work history: every entry required a date range,
 * so a CV listing four jobs on four lines yielded nothing at all.
 */
describe("parseExperience: entries with no dates", () => {
  it("reads one job per line and splits employer from role", () => {
    const section = [
      "Timula gemer & water- bookkeeper",
      "RC Belle- beautician",
      "Matseke's VIP catering events- sales administrator",
      "Cyprus direct marketing (Credico)-Independent sales agent",
    ].join("\n");

    const entries = parseExperience(section);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ title: "bookkeeper", company: "Timula gemer & water" });
    // The dash has no space before it here, and none after it on the last line.
    expect(entries[3]).toMatchObject({
      title: "Independent sales agent",
      company: "Cyprus direct marketing (Credico)",
    });
  });

  it("records the dates as unknown rather than inventing them", () => {
    const [entry] = parseExperience("RC Belle- beautician");
    expect(entry.start_date).toBeNull();
    expect(entry.end_date).toBeNull();
    expect(entry.is_current).toBe(false);
  });

  it("ignores prose and bullets in the same section", () => {
    const section = [
      "Acme Corp- developer",
      "I was responsible for maintaining the payment service.",
      "• Fixed the nightly batch",
      "References available on request",
    ].join("\n");

    const entries = parseExperience(section);
    expect(entries).toHaveLength(1);
    expect(entries[0].company).toBe("Acme Corp");
  });

  it("never displaces a dated entry", () => {
    // The fallback only runs when nothing else matched, so a CV that already
    // parses cannot be affected by it.
    const section = "Senior Developer | Acme Corp\nJanuary 2020 - March 2023\nBuilt the platform";
    const entries = parseExperience(section);
    expect(entries).toHaveLength(1);
    expect(entries[0].start_date).toBe("January 2020");
  });
});
