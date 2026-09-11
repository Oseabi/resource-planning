import { describe, it, expect } from "vitest";
import {
  deriveTechnicalSkills,
  deriveCertifications,
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
