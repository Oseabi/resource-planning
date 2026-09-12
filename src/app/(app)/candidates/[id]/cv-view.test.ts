import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateCvView } from "@/app/(app)/candidates/[id]/cv-view";
import type { Database } from "@/lib/supabase/database.types";

type Candidate = Database["public"]["Tables"]["candidates"]["Row"];

/** A record shaped like one read off the issued template. Invented values. */
const candidate: Candidate = {
  id: "c1",
  full_name: "Thandi Example",
  email: null,
  phone: null,
  current_role: "Business Analyst",
  additional_roles: ["Scrum Master"],
  years_experience: 10,
  professional_summary: "Thandi is an accomplished Business Analyst.",
  availability: "notice_period",
  availability_note: "1 Calendar Month",
  designated_group: "African, Female",
  available_from: null,
  status: "active",
  location: null,
  notes: null,
  skills: ["Requirements elicitation"],
  technical_skills: ["SQL"],
  certifications: ["CBAP"],
  qualifications: ["Business Systems Analysis"],
  sectors: ["Public Sector"],
  languages: ["English", "isiXhosa"],
  resource_categories: ["BA"],
  linkedin_url: null,
  portfolio_url: null,
  work_experience: [
    {
      title: "Business Analyst",
      company: "University of Example",
      client: null,
      location: null,
      employment_type: null,
      start_date: "October 2020",
      end_date: null,
      is_current: true,
      description: "Collaborated with stakeholders.\nAnalysed existing processes.",
      achievements: null,
    },
  ],
  education: [{ qualification: "Business Systems Analysis", field: null, institution: "The University of Example", year: "2022" }],
  cv_file_path: null,
  cv_original_filename: null,
  date_of_birth: "1991-12-21",
  cv_as_of: "2026-09-09",
  skill_matrix: [
    { category: "Programming Languages", skills: [{ name: "SQL", years: "5+ years" }] },
    { category: "Tools", skills: [{ name: "Jira", years: "8+ years" }, { name: "Visio", years: "3 years" }] },
  ],
  certificates: [{ name: "CBAP", institution: "IIBA", year: "2021" }],
  projects: [{ company: "Eskom", projects: ["Payment system", "Library system"] }],
  achievements: "Service Excellence Award",
  created_by: null,
  created_at: "2026-09-10T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
  search_text: "",
} as Candidate;

function render(c: Candidate): string {
  return renderToStaticMarkup(createElement(CandidateCvView, { candidate: c, freeFrom: null }));
}

describe("CandidateCvView", () => {
  it("lays the record out in the issued template's order, under its names", () => {
    const html = render(candidate);
    const order = [
      "Candidate details",
      "Candidate overview",
      "Career summary",
      "Qualifications",
      "Certificates and courses",
      "Skillset",
      "Projects",
      "Achievements",
      "Employment history",
    ];
    const positions = order.map((title) => html.indexOf(`>${title}<`));
    expect(positions.every((p) => p >= 0), `missing: ${order.filter((_, i) => positions[i] < 0).join(", ")}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("prints the header table as the template does, dates included", () => {
    const html = render(candidate);
    for (const label of ["Full name", "Date of birth", "Position", "Designated group", "Years of experience", "Availability", "Languages", "CV as of"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain("21 December 1991");
    expect(html).toContain("09 September 2026");
    expect(html).toContain("1 Calendar Month");
    expect(html).toContain("English, isiXhosa");
  });

  it("derives the career summary from the employment history", () => {
    const html = render(candidate);
    expect(html).toContain("October 2020 - Current");
    expect(html).toContain("University of Example");
  });

  it("prints a skills row's years once when every skill agrees, and per skill when they differ", () => {
    const html = render(candidate);
    expect(html).toContain(">5+ years<");
    expect(html).toContain("Jira (8+ years); Visio (3 years)");
  });

  it("lists the duties as the CV's own lines, bullets and sub-headings apart", () => {
    const html = render({
      ...candidate,
      work_experience: [{ ...candidate.work_experience[0], description: "Team leadership\n\u2022 Collaborated with stakeholders.\n\u2022 Analysed existing processes." }],
    });
    expect(html).toContain(">Team leadership<");
    expect(html).toContain("<span>Collaborated with stakeholders.</span>");
    expect(html).toContain("<span>Analysed existing processes.</span>");
  });

  it("leaves out the sections the template prints only when the CV had them", () => {
    const html = render({ ...candidate, projects: [], achievements: null, certificates: [], certifications: [] });
    expect(html).not.toContain(">Projects<");
    expect(html).not.toContain(">Achievements<");
    expect(html).not.toContain(">Certificates and courses<");
    // The ones it always prints stay, with a blank line inside.
    expect(html).toContain(">Career summary<");
  });

  it("falls back to the flat lists when a record has no tables", () => {
    const html = render({ ...candidate, skill_matrix: [], education: [], certificates: [] });
    expect(html).toContain("SQL");
    expect(html).toContain("Requirements elicitation");
    expect(html).toContain("Business Systems Analysis");
    expect(html).toContain("CBAP");
  });
});
