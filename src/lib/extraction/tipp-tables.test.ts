import { describe, it, expect } from "vitest";
import { tablesFromHtml, cellText, isEmptyRow } from "@/lib/extraction/docx-tables";
import {
  parseTippTables,
  looksLikeCertification,
  isCertificationEntry,
} from "@/lib/extraction/tipp-tables";

const HEADER = [
  ["FULL NAME (S)", "Desmond Letshedi"],
  ["POSITION", "D365 F&O Developer"],
  ["DESIGNATED GROUP", "African Male"],
  ["LANGUAGES", "English"],
];

const NOW = new Date("2026-08-27T00:00:00Z");

describe("tablesFromHtml", () => {
  it("keeps an empty cell as an empty cell", () => {
    // This is the whole point of reading tables rather than flattened text. In
    // the text a missing year simply is not there, so the row below runs into
    // the one above and two qualifications become one.
    const html = `<table>
      <tr><td>National Senior Certificate</td><td>Reitumetse High</td><td></td></tr>
      <tr><td>BEng Computer Engineering</td><td>University Of Pretoria</td><td>2017</td></tr>
    </table>`;
    expect(tablesFromHtml(html)).toEqual([
      [
        ["National Senior Certificate", "Reitumetse High", ""],
        ["BEng Computer Engineering", "University Of Pretoria", "2017"],
      ],
    ]);
  });

  it("keeps a cell's paragraphs as separate lines", () => {
    // A duties cell holds one bullet per paragraph, and flattening them would
    // merge separate responsibilities into one sentence.
    expect(cellText("<p>Ran the migration</p><p>Wrote the test pack</p>")).toBe(
      "Ran the migration\nWrote the test pack",
    );
  });

  it("decodes entities so an ampersand is not left escaped", () => {
    expect(cellText("<p>Finance &amp; Operations</p>")).toBe("Finance & Operations");
  });

  it("does not count a nested table's rows twice", () => {
    // The template never nests tables, but a stray one must not silently double
    // a candidate's job history. Nested content is absorbed into the parent
    // cell, which loses the inner structure but cannot duplicate a row.
    const html = `<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>`;
    const rows = tablesFromHtml(html).flat();
    expect(rows).toHaveLength(1);
    expect(rows.flat().join(" ")).not.toMatch(/inner.*inner/);
  });

  it("recognises a blank row", () => {
    expect(isEmptyRow(["", "  ", ""])).toBe(true);
    expect(isEmptyRow(["", "Matric", ""])).toBe(false);
  });
});

describe("parseTippTables", () => {
  it("declines anything that is not the template", () => {
    expect(parseTippTables([[["Name", "Jane"]]], NOW)).toBeNull();
    expect(parseTippTables([], NOW)).toBeNull();
  });

  it("reads the header block", () => {
    const r = parseTippTables([HEADER], NOW)!;
    expect(r.full_name).toBe("Desmond Letshedi");
    expect(r.current_role).toBe("D365 F&O Developer");
    expect(r.designated_group).toBe("African Male");
    expect(r.languages).toEqual(["English"]);
  });

  it("keeps a qualification with no year as its own row", () => {
    const r = parseTippTables(
      [
        HEADER,
        [["QUALIFICATION"]],
        [
          ["QUALIFICATION", "INSTITUTION", "YEAR"],
          ["National Senior Certificate", "Reitumetse High", ""],
          ["BEng Computer Engineering", "University Of Pretoria", "2017"],
        ],
      ],
      NOW,
    )!;
    expect(r.qualifications).toEqual([
      "National Senior Certificate",
      "BEng Computer Engineering",
    ]);
    expect(r.education[0].year).toBeNull();
  });

  it("splits certifications out of the qualification table", () => {
    // These CVs list vendor certifications beside degrees. Read as education
    // they score nothing against a tender's certification requirement, which is
    // worth 20 of the 100 matching points.
    const r = parseTippTables(
      [
        HEADER,
        [["QUALIFICATION"]],
        [
          ["QUALIFICATION", "INSTITUTION", "YEAR"],
          ["Bachelor Of Theology", "TEE", "2004"],
          ["Microsoft Certified Solutions Developer", "CTU", "2004"],
          ["Matric", "Oos Rand Secondary", "1999"],
        ],
      ],
      NOW,
    )!;
    expect(r.qualifications).toEqual(["Bachelor Of Theology", "Matric"]);
    expect(r.certifications).toEqual(["Microsoft Certified Solutions Developer"]);
  });

  it("takes a heading that shares a table with its content", () => {
    // Both layouts occur: the heading is sometimes its own table and sometimes
    // the first row of the table holding the section.
    const r = parseTippTables(
      [HEADER, [["SKILLS AND TRAINING"], ["ITIL v4"], ["Data Modelling"]]],
      NOW,
    )!;
    expect(r.certifications).toContain("ITIL v4");
    expect([...r.skills, ...r.technical_skills]).toContain("Data Modelling");
  });

  it("reads the career table and the employment blocks", () => {
    const r = parseTippTables(
      [
        HEADER,
        [["CAREER SUMMARY"]],
        [
          ["COMPANY", "POSITION", "DURATION"],
          ["Altron Karabina", "Consultant", "January 2020 - Current"],
        ],
        [["EMPLOYMENT RECORD"]],
        [
          ["Company", "Altron Karabina"],
          ["Client", "Old Mutual"],
          ["Role", "Consultant"],
          ["Duration", "January 2020 - Current"],
          ["Duties", "Built the integration\nRan the migration"],
        ],
      ],
      NOW,
    )!;

    const [job] = r.work_experience;
    expect(job.company).toBe("Altron Karabina");
    expect(job.title).toBe("Consultant");
    expect(job.is_current).toBe(true);
    expect(job.description).toBe("Client: Old Mutual\nBuilt the integration\nRan the migration");
  });

  it("recovers a summary written under CAREER SUMMARY", () => {
    const r = parseTippTables(
      [HEADER, [["CAREER SUMMARY"], ["Desmond is an experienced developer."]]],
      NOW,
    )!;
    expect(r.professional_summary).toBe("Desmond is an experienced developer.");
  });

  it("does not treat the career table as prose", () => {
    // The prose fallback must only fire when there is genuinely no table, or a
    // whole career history ends up in the professional summary.
    const r = parseTippTables(
      [
        HEADER,
        [["CAREER SUMMARY"]],
        [
          ["COMPANY", "POSITION", "DURATION"],
          ["Altron", "Consultant", "2020 - 2022"],
        ],
      ],
      NOW,
    )!;
    expect(r.professional_summary).toBeNull();
  });
});

describe("looksLikeCertification", () => {
  it("keeps academic awards as qualifications", () => {
    expect(looksLikeCertification("Bachelor Of Theology", "TEE")).toBe(false);
    expect(looksLikeCertification("National Diploma in IT", "Pretoria Technikon")).toBe(false);
    expect(looksLikeCertification("Matric", "Oos Rand Secondary")).toBe(false);
    // Mentions a vendor but is still a degree.
    expect(looksLikeCertification("BSc Computer Science", "Microsoft")).toBe(false);
  });

  it("treats vendor awards as certifications", () => {
    expect(looksLikeCertification("Microsoft Certified Solutions Developer", "CTU")).toBe(true);
    expect(looksLikeCertification("Azure Data Engineer Associate", "Microsoft")).toBe(true);
    // A vendor as the awarding body is enough on its own.
    expect(looksLikeCertification("Dynamics 365 Finance", "Microsoft")).toBe(true);
  });
});

describe("isCertificationEntry", () => {
  it("picks exam codes out of a skills list", () => {
    expect(isCertificationEntry("PL – 400 – Microsoft ( October 2022)")).toBe(true);
    expect(isCertificationEntry("AZ-104")).toBe(true);
    expect(isCertificationEntry("ITIL v4 – (October 2022)")).toBe(true);
  });

  it("leaves ordinary skills alone", () => {
    // Stricter than the qualification test, because a skills list is full of
    // product names that are skills rather than exams.
    expect(isCertificationEntry("Microsoft Dynamics 365")).toBe(false);
    expect(isCertificationEntry("Data Modelling")).toBe(false);
    expect(isCertificationEntry("SQL")).toBe(false);
  });
});
