import { describe, it, expect } from "vitest";
import {
  deriveTechnicalSkills,
  deriveCertifications,
  deriveQualifications,
  durationOf,
  cleanSkillMatrix,
  cleanCertificates,
} from "@/lib/cv-record";

describe("deriveTechnicalSkills", () => {
  const matrix = [
    { category: "Languages", skills: [{ name: "SQL", years: "10+ years" }, { name: "Java", years: null }] },
    { category: "Tools", skills: [{ name: "Power BI", years: "5 years" }] },
  ];

  it("puts every skill in the matrix into the flat list", () => {
    expect(deriveTechnicalSkills(matrix, [])).toEqual(["SQL", "Java", "Power BI"]);
  });

  it("keeps a skill typed straight into the flat list", () => {
    // Somebody adds a skill on the form without a category. It stays.
    expect(deriveTechnicalSkills(matrix, ["Excel"])).toEqual(["Excel", "SQL", "Java", "Power BI"]);
  });

  it("does not list a skill twice for a difference of case", () => {
    expect(deriveTechnicalSkills(matrix, ["sql", "Power  BI"])).toEqual(["sql", "Power  BI", "Java"]);
  });

  it("is a no-op the second time, so a re-save changes nothing", () => {
    const once = deriveTechnicalSkills(matrix, []);
    expect(deriveTechnicalSkills(matrix, once)).toEqual(once);
  });
});

describe("deriveCertifications", () => {
  it("puts every detailed certificate's name into the flat list", () => {
    const certs = [
      { name: "TOGAF 9.2", institution: "The Open Group", year: "2022" },
      { name: "PMP", institution: null, year: null },
    ];
    expect(deriveCertifications(certs, ["ITIL"])).toEqual(["ITIL", "TOGAF 9.2", "PMP"]);
  });
});

describe("cleanSkillMatrix", () => {
  it("drops blank rows and blank skills, and names a category left blank", () => {
    const out = cleanSkillMatrix([
      { category: "  ", skills: [] },
      { category: "", skills: [{ name: "SQL", years: " 10 years " }, { name: "  ", years: null }] },
      { category: "Tools", skills: [{ name: "Visio", years: "", note: "" }] },
    ]);
    expect(out).toEqual([
      { category: "General", skills: [{ name: "SQL", years: "10 years", note: null }] },
      { category: "Tools", skills: [{ name: "Visio", years: null, note: null }] },
    ]);
  });
});

describe("cleanCertificates", () => {
  it("drops a row with no name and trims the rest", () => {
    expect(
      cleanCertificates([
        { name: "", institution: "X", year: "2020" },
        { name: " PMP ", institution: " PMI ", year: "" },
      ]),
    ).toEqual([{ name: "PMP", institution: "PMI", year: null }]);
  });
});

describe("deriveQualifications", () => {
  const education = [
    { qualification: "BSc Computer Science", field: null, institution: "UCT", year: "2011" },
    { qualification: "Matric", field: null, institution: null, year: "2005" },
  ];

  it("puts every education row's award into the flat list", () => {
    expect(deriveQualifications(education, [])).toEqual(["BSc Computer Science", "Matric"]);
  });

  it("keeps an award typed straight into the list, and never doubles one", () => {
    expect(deriveQualifications(education, ["MBA", "matric"])).toEqual(["MBA", "matric", "BSc Computer Science"]);
  });
});

describe("durationOf", () => {
  it("writes a range the way the template does", () => {
    expect(durationOf({ start_date: "April 2016", end_date: "September 2020", is_current: false })).toBe(
      "April 2016 - September 2020",
    );
  });

  it("says Current for a current job whatever the end date holds", () => {
    expect(durationOf({ start_date: "October 2020", end_date: null, is_current: true })).toBe("October 2020 - Current");
  });

  it("is the start alone when that is all there is, and nothing without a start", () => {
    expect(durationOf({ start_date: "2014", end_date: null, is_current: false })).toBe("2014");
    expect(durationOf({ start_date: null, end_date: "2016", is_current: false })).toBe("");
  });
});
