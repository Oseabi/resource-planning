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
    // The client is a field of its own now, not a line smuggled into the duties.
    expect(job.client).toBe("Old Mutual");
    expect(job.description).toBe("Built the integration\nRan the migration");
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

describe("parseTippTables on the issued template", () => {
  const HEADER = [
    ["FULL NAME (S)", "Thandi Example"],
    ["DATE OF BIRTH", "05 February 1989"],
    ["POSITON", "Lead Enterprise Architect"],
    ["DESIGNATED GROUP", "African Female"],
    ["YEARS OF EXPERIENCE", "14+ years"],
    ["AVAILABILITY", "Immediately"],
  ];

  it("reads POSITON, which is how every issued copy spells it", () => {
    const r = parseTippTables([HEADER]);
    expect(r?.current_role).toBe("Lead Enterprise Architect");
  });

  it("prefers the stated years to a sum of overlapping contracts", () => {
    const r = parseTippTables([
      HEADER,
      [["CAREER SUMMARY"]],
      [
        ["COMPANY", "POSITION", "DURATION"],
        ["A", "Architect", "January 2000 - December 2024"],
        ["B", "Architect", "January 2000 - December 2024"],
      ],
    ]);
    expect(r?.years_experience).toBe(14);
  });

  it("reads the date of birth", () => {
    expect(parseTippTables([HEADER])?.date_of_birth).toBe("05 February 1989");
  });

  it("reads the SKILLSET table into categories, and derives the flat lists from it", () => {
    const r = parseTippTables([
      HEADER,
      [["SKILLS"]],
      [
        ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"],
        ["Programming Languages", "SQL / Transact-SQL", "10+ years"],
        ["Technologies", "Business Architecture\nBusiness Analysis", "10+ years\n15+ years"],
        ["Frameworks", "TOGAF, ArchiMate", "8+ years"],
      ],
    ]);
    expect(r?.skill_matrix).toEqual([
      { category: "Programming Languages", skills: [{ name: "SQL / Transact-SQL", years: "10+ years" }] },
      {
        category: "Technologies",
        skills: [
          { name: "Business Architecture", years: "10+ years" },
          { name: "Business Analysis", years: "15+ years" },
        ],
      },
      // One years value for the row applies to every skill in it.
      {
        category: "Frameworks",
        skills: [
          { name: "TOGAF", years: "8+ years" },
          { name: "ArchiMate", years: "8+ years" },
        ],
      },
    ]);
    const flat = [...(r?.skills ?? []), ...(r?.technical_skills ?? [])];
    expect(flat).toContain("SQL / Transact-SQL");
    expect(flat).toContain("Business Analysis");
  });

  it("splits a semicolon list on the semicolons alone, commas included in the items", () => {
    const r = parseTippTables([
      HEADER,
      [["SKILLS"]],
      [
        ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"],
        ["Tools", "Sparx Enterprise Architect; Jira; Microsoft Excel, Word and PowerPoint.", "8+ years"],
      ],
    ]);
    expect(r?.skill_matrix).toEqual([
      {
        category: "Tools",
        skills: [
          { name: "Sparx Enterprise Architect", years: "8+ years" },
          { name: "Jira", years: "8+ years" },
          { name: "Microsoft Excel, Word and PowerPoint", years: "8+ years" },
        ],
      },
    ]);
  });

  it("reads the older SKILLS MATRIX with its self-rating and months", () => {
    const r = parseTippTables([
      HEADER,
      [["SKILLS"]],
      [
        ["", "MATRIX"],
        ["Skill Self - Rating", "Experience", "Last Used"],
        ["ADA 3", "12 Months", "November 1992"],
        ["COBOL 8", "36 Months", "April 1999"],
        ["Databases"],
        ["Oracle 7", "48 Months", "June 2004"],
      ],
    ]);
    expect(r?.skill_matrix).toEqual([
      {
        category: "General",
        skills: [
          { name: "ADA", years: "1 year", note: "self-rated 3/10, last used November 1992" },
          { name: "COBOL", years: "3 years", note: "self-rated 8/10, last used April 1999" },
        ],
      },
      { category: "Databases", skills: [{ name: "Oracle", years: "4 years", note: "self-rated 7/10, last used June 2004" }] },
    ]);
  });

  it("reads a single-column certificates table without taking its header for the section", () => {
    const r = parseTippTables([
      HEADER,
      [["CERTIFICATES AND COURSES"]],
      [["QUALIFICATION"], ["TOGAF 9.1 Certified"], ["DAMA training through AFSUG"]],
    ]);
    expect(r?.certificates).toEqual([
      { name: "TOGAF 9.1 Certified", institution: null, year: null },
      { name: "DAMA training through AFSUG", institution: null, year: null },
    ]);
    expect(r?.certifications).toContain("TOGAF 9.1 Certified");
  });

  it("keeps a certificate's institution and year", () => {
    const r = parseTippTables([
      HEADER,
      [["CERTIFICATES AND COURSES"]],
      [
        ["QUALIFICATION", "INSTITUTION", "YEAR"],
        ["TOGAF 9.2 Certified", "The Open Group", "2022"],
      ],
    ]);
    expect(r?.certificates).toEqual([{ name: "TOGAF 9.2 Certified", institution: "The Open Group", year: "2022" }]);
  });

  it("reads the PROJECTS table", () => {
    const r = parseTippTables([
      HEADER,
      [["PROJECTS"]],
      [
        ["COMPANY NAME", "PROJECT NAME"],
        ["Eskom", "Enterprise Historian\nVoice interception"],
      ],
    ]);
    expect(r?.projects).toEqual([{ company: "Eskom", projects: ["Enterprise Historian", "Voice interception"] }]);
  });

  it("keeps ACHIEVEMENTS as written", () => {
    const r = parseTippTables([HEADER, [["ACHIEVEMENTS"]], [["Expertise\nStrategic Planning\nTechnology Courses\nAgile for Teams"]]]);
    expect(r?.achievements).toBe("Expertise\nStrategic Planning\nTechnology Courses\nAgile for Teams");
  });

  it("flattens titled sub-roles inside one employer into one job each", () => {
    const r = parseTippTables([
      HEADER,
      [["EMPLOYMENT RECORD"]],
      [
        ["Company", "CA ANZ"],
        ["Client", "The Institute"],
        ["Role", "Business Architect / Practice Principal"],
        ["Duration", "June 2012 – March 2018"],
        [
          "Duties:\nBusiness Architect (CA ANZ) (June 2016 – March 2018)\nIntroduced capability planning\nBusiness Analysis Practice Principal | (January 2015 – June 2016)\nRan the practice",
        ],
      ],
    ]);
    const jobs = r?.work_experience ?? [];
    expect(jobs.map((j) => j.title)).toEqual([
      "Business Architect (CA ANZ)",
      "Business Analysis Practice Principal",
    ]);
    expect(jobs.every((j) => j.company === "CA ANZ" && j.client === "The Institute")).toBe(true);
    expect(jobs[0].start_date).toMatch(/2016/);
    expect(jobs[0].description).toBe("Introduced capability planning");
    expect(jobs[1].description).toBe("Ran the practice");
  });

  it("keeps the block itself when it has duties before the first sub-role", () => {
    const r = parseTippTables([
      HEADER,
      [["EMPLOYMENT RECORD"]],
      [
        ["Company", "iMas"],
        ["Role", "Consultant"],
        ["Duration", "2019 – 2026"],
        ["Duties:\nAn intro paragraph about the engagement\nHead of Architecture (July 2025 – June 2026)\nLed the team"],
      ],
    ]);
    const jobs = r?.work_experience ?? [];
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe("Consultant");
    expect(jobs[0].description).toBe("An intro paragraph about the engagement");
    expect(jobs[1].title).toBe("Head of Architecture");
  });

  it("reads a block with no sub-roles as one job, as before", () => {
    const r = parseTippTables([
      HEADER,
      [["EMPLOYMENT RECORD"]],
      [
        ["Company", "Tower Group"],
        ["Client", "MWEB"],
        ["Role", "IT Technical Consultant"],
        ["Duration", "August 2007 – April 2008"],
        ["Duties:\nProviding support\nProcessing reports"],
      ],
    ]);
    expect(r?.work_experience).toEqual([
      expect.objectContaining({
        title: "IT Technical Consultant",
        company: "Tower Group",
        client: "MWEB",
        description: "Providing support\nProcessing reports",
      }),
    ]);
  });
});
