import { describe, it, expect } from "vitest";
import { splitSections, collapseLetterSpacing, matchHeading } from "@/lib/extraction/sections";
import {
  parseListItems,
  classifySkills,
  parseExperience,
  parseEducation,
  extractLinks,
} from "@/lib/extraction/heuristics";
import { parseTextToFields } from "@/lib/extraction/local-parser";

const SOFTWARE_CV = `Ofentse Seabi
ERP Consultant & Functional Analyst
Krugersdorp, Gauteng | fennyseabi@gmail.com | 081 042 7788
linkedin.com/in/ofentse-seabi | github.com/ofentse

Professional Summary
Results-driven ERP Consultant and Functional Analyst with hands-on experience
implementing Microsoft Dynamics 365 Finance & Operations for public-sector clients.

Technical Skills
Microsoft Dynamics 365 F&O, X++, JavaScript, TypeScript, React, Next.js, Node.js,
MongoDB, PostgreSQL, SQL, Tailwind CSS, Git, Supabase

Skills
Business Process Analysis, Functional Specification Writing, Stakeholder Management,
Project Management

Experience
ERP Consultant - Tipp Focus Holdings
2022 - Present
- Configured D365 F&O modules for public-sector finance clients
- Authored functional specifications and ran UAT sessions

Junior Developer at Great Learning
2020 - 2022
- Built internal web tools with the MERN stack

Education
BCom Information Systems - University of Johannesburg (2021)

Certifications
Microsoft Certified: Dynamics 365 F&O Apps Developer Associate
PRINCE2 Foundation

Languages
English, Afrikaans, Tswana
`;

describe("splitSections", () => {
  it("separates a CV into labelled sections", () => {
    const { preamble, sections } = splitSections(SOFTWARE_CV);
    expect(preamble).toContain("Ofentse Seabi");
    expect(sections.summary).toContain("ERP Consultant and Functional Analyst");
    expect(sections.technical_skills).toContain("X++");
    expect(sections.skills).toContain("Stakeholder Management");
    expect(sections.experience).toContain("Tipp Focus Holdings");
    expect(sections.education).toContain("University of Johannesburg");
    expect(sections.certifications).toContain("PRINCE2 Foundation");
    expect(sections.languages).toContain("Afrikaans");
  });
});

describe("parseListItems", () => {
  it("splits comma and newline lists, dropping prose", () => {
    const items = parseListItems("React, Node.js, MongoDB\nPostgreSQL");
    expect(items).toEqual(["React", "Node.js", "MongoDB", "PostgreSQL"]);
  });
});

describe("classifySkills", () => {
  it("routes technical terms to technical and the rest to professional", () => {
    const { technical, professional } = classifySkills([
      "React",
      "X++",
      "Stakeholder Management",
      "SQL",
    ]);
    expect(technical).toContain("React");
    expect(technical).toContain("X++");
    expect(technical).toContain("SQL");
    expect(professional).toContain("Stakeholder Management");
  });
});

describe("parseExperience", () => {
  it("extracts entries with titles, companies and current flag", () => {
    const entries = parseExperience(
      `ERP Consultant - Tipp Focus Holdings\n2022 - Present\n- Configured D365\n\nJunior Developer at Great Learning\n2020 - 2022\n- Built tools`,
    );
    expect(entries.length).toBe(2);
    expect(entries[0].title).toBe("ERP Consultant");
    expect(entries[0].company).toBe("Tipp Focus Holdings");
    expect(entries[0].is_current).toBe(true);
    expect(entries[1].title).toBe("Junior Developer");
    expect(entries[1].company).toBe("Great Learning");
    expect(entries[1].is_current).toBe(false);
  });

  it("handles the .docx layout with blank lines between every paragraph", () => {
    // mammoth inserts a blank line between paragraphs, so the title sits two lines
    // above its date range.
    const entries = parseExperience(
      "ERP Consultant - Tipp Focus Holdings\n\n2021 - Present\n\nConfigured D365 modules.\n\n\n\nFull Stack Developer at Fintech Startup\n\n2018 - 2021\n\nBuilt web apps.",
    );
    expect(entries.length).toBe(2);
    expect(entries[0].title).toBe("ERP Consultant");
    expect(entries[0].company).toBe("Tipp Focus Holdings");
    expect(entries[0].description).toBe("Configured D365 modules.");
    expect(entries[1].title).toBe("Full Stack Developer");
    expect(entries[1].company).toBe("Fintech Startup");
  });
});

describe("parseEducation", () => {
  it("extracts qualification, institution and year", () => {
    const edu = parseEducation("BCom Information Systems - University of Johannesburg (2021)");
    expect(edu.length).toBe(1);
    expect(edu[0].qualification).toContain("BCom Information Systems");
    expect(edu[0].institution).toContain("University of Johannesburg");
    expect(edu[0].year).toBe("2021");
  });
});

describe("extractLinks", () => {
  it("separates LinkedIn from portfolio/GitHub", () => {
    const links = extractLinks("linkedin.com/in/ofentse-seabi github.com/ofentse");
    expect(links.linkedin_url).toContain("linkedin.com/in/ofentse-seabi");
    expect(links.portfolio_url).toContain("github.com/ofentse");
  });
});

describe("parseTextToFields on a software CV", () => {
  it("auto-fills a rich multi-industry profile with no AI", () => {
    const f = parseTextToFields(SOFTWARE_CV, "ofentse_seabi_cv.pdf");
    expect(f.full_name).toBe("Ofentse Seabi");
    expect(f.email).toBe("fennyseabi@gmail.com");
    expect(f.linkedin_url).toContain("linkedin.com");
    expect(f.portfolio_url).toContain("github.com");
    expect(f.professional_summary).toContain("ERP Consultant");

    // Technical skills captured even though many aren't in any curated pack.
    expect(f.technical_skills).toContain("X++");
    expect(f.technical_skills).toContain("React");
    expect(f.technical_skills).toContain("MongoDB");
    // Professional skills separated out.
    expect(f.skills).toContain("Stakeholder Management");

    // Multiple roles, primary first.
    expect(f.current_role).toBe("ERP Consultant");
    expect(f.additional_roles).toContain("Junior Developer");

    // Structured history.
    expect(f.work_experience.length).toBe(2);
    expect(f.education.length).toBeGreaterThanOrEqual(1);
    expect(f.languages).toContain("Afrikaans");
    expect(f.certifications.some((c) => /Dynamics 365/.test(c))).toBe(true);
  });
});

/**
 * Letter-spaced headings, which broke a real CV completely.
 *
 * Tracking a heading out is a common design choice, and the extracted text
 * keeps the spaces. One CV in the corpus produced no work history, no
 * education, no summary and no experience total, because not one of its
 * sections was recognised.
 */
describe("collapseLetterSpacing", () => {
  it("recovers a heading that was tracked out", () => {
    expect(collapseLetterSpacing("W O R K - E X P E R I E N C E")).toBe("WORK EXPERIENCE");
    expect(collapseLetterSpacing("P R O F E S S I O N A L - S U M M A R Y")).toBe(
      "PROFESSIONAL SUMMARY",
    );
  });

  it("leaves an ordinary heading untouched", () => {
    expect(collapseLetterSpacing("WORK EXPERIENCE")).toBe("WORK EXPERIENCE");
    expect(collapseLetterSpacing("Education & Certifications")).toBe("Education & Certifications");
  });

  it("leaves prose alone even when it has short words", () => {
    const prose = "I am a hard worker and I do a lot of work";
    expect(collapseLetterSpacing(prose)).toBe(prose);
  });

  it("makes the tracked-out heading match as a section", () => {
    expect(matchHeading("W O R K - E X P E R I E N C E")).toContain("experience");
  });
});

describe("headings that terminate a section", () => {
  it("stops the skills list at PROJECTS", () => {
    // Without a match for PROJECTS the whole projects write-up was read as
    // skills. One CV came back with 66 technical skills, among them
    // "supporting multiple chat rooms" and a github.com link.
    const { sections } = splitSections(`TECHNICAL SKILLS

React, Node.js, PostgreSQL

PROJECTS

ChatFlow Real-Time Chat Application

Built a chat application with WebSockets, supporting multiple chat rooms.`);
    expect(sections.technical_skills?.trim()).toBe("React, Node.js, PostgreSQL");
    expect(sections.projects).toContain("ChatFlow");
    expect(sections.technical_skills).not.toContain("chat rooms");
  });

  it("leaves PROJECT EXPERIENCE as employment history", () => {
    // The projects patterns are anchored so they cannot swallow a section that
    // is genuinely a work history.
    expect(matchHeading("PROJECT EXPERIENCE")).toEqual([]);
    expect(matchHeading("PROJECTS")).toEqual(["projects"]);
    expect(matchHeading("Key Projects")).toEqual(["projects"]);
  });

  it("stops a section at headings nothing reads", () => {
    for (const heading of ["INTERESTS", "PUBLICATIONS", "PERSONAL DETAILS", "DECLARATION"]) {
      expect(matchHeading(heading)).toEqual(["other"]);
    }
  });

  it("files awards with the other achievements", () => {
    expect(matchHeading("AWARDS")).toEqual(["achievements"]);
  });
});

describe("skills lists with grouped labels", () => {
  it("does not glue one group onto the label of the next", () => {
    // These lines are about as long as a wrapped sentence, so the unwrapper
    // joined them and invented "R Frontend: React".
    const items = parseListItems(`Languages:  JavaScript, HTML5, SQL, R
Frontend:  React, Vite, Tailwind CSS`);
    expect(items).toContain("React");
    expect(items).toContain("Vite");
    expect(items.join(" ")).not.toContain("R Frontend");
    // The label names the group, it is not a skill in its own right.
    expect(items).not.toContain("Languages");
  });

  it("keeps a bracketed list of dialects out of the skill name", () => {
    // Splitting inside the brackets produced "SQL (PostgreSQL", which the
    // bracket repair turned into a "SQL PostgreSQL" nobody has heard of.
    const items = parseListItems("data modelling, SQL (PostgreSQL, MS SQL), Microsoft Access");
    expect(items).toContain("SQL");
    expect(items).toContain("PostgreSQL");
    expect(items).toContain("MS SQL");
    expect(items).not.toContain("SQL PostgreSQL");
  });

  it("names each product under the vendor that supplies it", () => {
    const items = parseListItems("SAP (S/4HANA, ECC, GRC, SuccessFactors)");
    expect(items).toContain("SAP S/4HANA");
    expect(items).toContain("SAP GRC");
    expect(items).toContain("SAP");
  });

  it("leaves a version note attached to the thing it qualifies", () => {
    // No comma inside the brackets, so this is a qualifier rather than a list.
    const items = parseListItems("JavaScript (ES6+), Socket.io (WebSockets)");
    expect(items).toContain("JavaScript (ES6+)");
    expect(items).toContain("Socket.io (WebSockets)");
  });

  it("starts a new item after a bracket closes", () => {
    // The CV left out a comma: "Microsoft Excel (Advanced) Jira, Lucid chart".
    const items = parseListItems("Microsoft Office Suite, Microsoft Excel (Advanced) Jira, Lucid chart");
    expect(items).toContain("Microsoft Excel (Advanced)");
    expect(items).toContain("Jira");
  });

  it("keeps links and sentence clauses out of a skills list", () => {
    const items = parseListItems(`github.com/Oseabi/chat-app, supporting multiple chat rooms,
Implemented automated status tracking, Socket.io, Reporting`);
    expect(items).not.toContain("github.com/Oseabi/chat-app");
    expect(items).not.toContain("supporting multiple chat rooms");
    expect(items).not.toContain("Implemented automated status tracking");
    // A one-word gerund is a real skill and a product name is not a link.
    expect(items).toContain("Socket.io");
    expect(items).toContain("Reporting");
  });
});

describe("skills that only look like duplicates", () => {
  const cv = (skills: string) => `Sipho Ndlovu
sipho@example.com

TECHNICAL SKILLS
${skills}

EXPERIENCE
Software Developer | Acme	2021 - present
`;

  it("keeps two technologies whose names overlap", () => {
    // Plain containment was treating these as the same skill, so a tender
    // asking for SQL stopped matching a developer who had listed it.
    const f = parseTextToFields(cv("PostgreSQL, Supabase (PostgreSQL + RLS), SQL, Git, GitHub"), "sipho.pdf");
    for (const skill of ["PostgreSQL", "SQL", "Git", "GitHub"]) {
      expect(f.technical_skills).toContain(skill);
    }
  });

  it("still drops a name written out more fully elsewhere", () => {
    const f = parseTextToFields(cv("JavaScript, JavaScript (ES6+)"), "sipho.pdf");
    expect(f.technical_skills).toContain("JavaScript (ES6+)");
    expect(f.technical_skills).not.toContain("JavaScript");
  });
});
