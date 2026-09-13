import { describe, it, expect } from "vitest";
import {
  TENDER_SCHEMA,
  buildTenderPrompt,
  coerceTenderAi,
  mergeTenderExtraction,
  endDateFrom,
  seatNotes,
  truncateTenderText,
  TENDER_TEXT_CHAR_CAP,
} from "@/lib/extraction/tender-ai";
import { emptyTenderFields } from "@/lib/extraction/rfq-parser";

/** Every object in a Gemini schema names all its properties as required, so the model answers every field. */
function requiresEverything(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return true;
  const s = schema as { type?: string; properties?: Record<string, unknown>; required?: string[]; items?: unknown };
  if (s.type === "OBJECT") {
    const keys = Object.keys(s.properties ?? {});
    if (!s.required || keys.some((k) => !s.required!.includes(k))) return false;
    return keys.every((k) => requiresEverything(s.properties![k]));
  }
  if (s.type === "ARRAY") return requiresEverything(s.items);
  return true;
}

describe("TENDER_SCHEMA", () => {
  it("is in Gemini's dialect and asks for every field", () => {
    expect(TENDER_SCHEMA.type).toBe("OBJECT");
    expect(requiresEverything(TENDER_SCHEMA)).toBe(true);
    // Upper-case types throughout, which is what the API accepts.
    expect(JSON.stringify(TENDER_SCHEMA)).not.toMatch(/"type":"(string|number|object|array|integer)"/);
    // No rand value: the field went from the form.
    expect(TENDER_SCHEMA.properties).not.toHaveProperty("value");
  });

  it("asks for the brief and for each seat's paragraphs, not only its lists", () => {
    expect(TENDER_SCHEMA.properties).toHaveProperty("summary");
    const seat = TENDER_SCHEMA.properties.positions.items.properties;
    for (const key of ["document_title", "experience", "evaluation", "duration", "notes"]) {
      expect(seat).toHaveProperty(key);
    }
  });
});

describe("buildTenderPrompt", () => {
  it("carries the exact role spellings matching scores on, and tells the model not to guess", () => {
    const prompt = buildTenderPrompt();
    expect(prompt).toContain("Business Analyst");
    expect(prompt).toMatch(/Never guess/);
    expect(prompt).toContain("YYYY-MM-DD");
  });

  it("sends the model to every place a tender keeps its people", () => {
    const prompt = buildTenderPrompt();
    for (const place of ["mandatory", "evaluation criteria", "returnable documents", "pricing schedule", "scope of work"]) {
      expect(prompt).toContain(place);
    }
    // The one thing every tender does that the reader must not: a points
    // band is not a minimum.
    expect(prompt).toMatch(/points band is not a minimum/);
    // Reference letters that earn points rather than gate the bid still count.
    expect(prompt).toMatch(/number that earns full points/);
    expect(prompt).not.toMatch(/\bvalue\b.*rand/);
  });
});

describe("seatNotes", () => {
  it("composes the document's words on a seat into labelled lines, leaving blanks out", () => {
    expect(
      seatNotes({
        role: "Enterprise Architect",
        document_title: "Lead Enterprise Architect, Form B2.1",
        experience: "Leads the EA workstream across all domains.",
        evaluation: "10 points on the CV and certifications attached to Form B2.1.",
        duration: "17 person-months",
        required_qualifications: ["TOGAF 9 certified"],
        notes: "On site in Pretoria.",
      }),
    ).toBe(
      [
        "In the document: Lead Enterprise Architect, Form B2.1",
        "Experience: Leads the EA workstream across all domains.",
        "Scoring: 10 points on the CV and certifications attached to Form B2.1.",
        "Duration: 17 person-months",
        "Qualifications: TOGAF 9 certified",
        "On site in Pretoria.",
      ].join("\n"),
    );
  });

  it("does not repeat a title that is only the role again, and is nothing when there is nothing", () => {
    expect(seatNotes({ role: "Project Manager", document_title: "project manager", experience: null, evaluation: null, duration: null, required_qualifications: [], notes: null })).toBeNull();
    expect(seatNotes({ role: "Project Manager", document_title: null, experience: "Ran cloud migrations.", evaluation: null, duration: null, required_qualifications: [], notes: null })).toBe("Experience: Ran cloud migrations.");
  });
});

describe("truncateTenderText", () => {
  it("leaves a document under the cap alone and cuts a longer one at a line", () => {
    expect(truncateTenderText("short").truncated).toBe(false);
    const long = Array.from({ length: 20_000 }, (_, i) => `line ${i} of a tender document`).join("\n");
    const { text, truncated } = truncateTenderText(long);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(TENDER_TEXT_CHAR_CAP);
    expect(text.endsWith("document")).toBe(true);
  });
});

describe("coerceTenderAi", () => {
  it("reads a well-formed answer, with the system's spellings", () => {
    const out = coerceTenderAi({
      title: " Provision of business analysis services ",
      reference_number: "RFP 03/2026",
      client: "Government Pensions Administration Agency",
      location: "Pretoria",
      submission_deadline: "2026-10-15",
      contract_start_date: "2026-11-01",
      contract_end_date: null,
      contract_duration_months: 36,
      reference_letters_required: 3,
      min_experience_years: 5,
      sectors: ["public sector"],
      required_skills: ["sql"],
      required_certifications: ["togaf"],
      positions: [
        { role: "business analyst", quantity: 3, min_experience_years: 5, required_skills: ["BPMN"], required_certifications: ["CBAP"], required_qualifications: ["BCom"], notes: null },
        { role: "Project Manager", quantity: null, min_experience_years: 8.4, required_skills: [], required_certifications: ["pmp"], required_qualifications: [], notes: "Must be on site" },
      ],
    });
    expect(out.title).toBe("Provision of business analysis services");
    expect(out.sectors).toEqual(["Public Sector"]);
    expect(out.positions[0].role).toBe("Business Analyst");
    expect(out.positions[0].quantity).toBe(3);
    expect(out.positions[1].quantity).toBe(1);
    expect(out.positions[1].min_experience_years).toBe(8.5);
    // Twenty years is a points value from an evaluation table, not a requirement.
    expect(coerceTenderAi({ min_experience_years: 20 }).min_experience_years).toBeNull();
    expect(out.positions[1].required_certifications).toEqual(["PMP"]);
    expect(out.required_roles).toEqual(["Business Analyst", "Project Manager"]);
    expect(out.contract_duration_months).toBe(36);
    expect(out.reference_letters_required).toBe(3);
    // The seat's paragraphs are kept as read and composed into its notes.
    expect(out.positions[1].notes).toBe("Must be on site");
    expect(out.positions[1].document_title).toBeNull();
  });

  it("composes each seat's notes from what the document says about it, and reads the brief", () => {
    const out = coerceTenderAi({
      summary: "  SANRAL wants an EA and BPM capability over 24 months.  ",
      positions: [
        {
          role: "enterprise architect",
          document_title: "Lead Enterprise Architect (Form B2.1)",
          quantity: 1,
          min_experience_years: null,
          required_skills: ["TOGAF"],
          required_certifications: ["togaf"],
          required_qualifications: [],
          experience: "Leads all architecture domains.",
          evaluation: "10 points; detailed CV and certifications on Form B2.1.",
          duration: "17 person-months",
          notes: null,
        },
      ],
    });
    expect(out.summary).toBe("SANRAL wants an EA and BPM capability over 24 months.");
    expect(out.positions[0].role).toBe("Enterprise Architect");
    expect(out.positions[0].notes).toBe(
      [
        "In the document: Lead Enterprise Architect (Form B2.1)",
        "Experience: Leads all architecture domains.",
        "Scoring: 10 points; detailed CV and certifications on Form B2.1.",
        "Duration: 17 person-months",
      ].join("\n"),
    );
  });

  it("keeps one seat when the document names the same one twice, and two when they only share a role", () => {
    const out = coerceTenderAi({
      positions: [
        { role: "Project Manager", document_title: "Project Manager, Form B4", quantity: 1, experience: "From the evaluation table." },
        { role: "project manager", document_title: "Project Manager, Form B4", quantity: 2, experience: "From the pricing schedule." },
        { role: "Functional Consultant", document_title: "D365 Finance & Operations Functional Consultant (item 4)", quantity: 1 },
        { role: "Functional Consultant", document_title: "D365 CRM Functional Consultant (item 5)", quantity: 1 },
      ],
    });
    expect(out.positions.map((p) => p.document_title)).toEqual([
      "Project Manager, Form B4",
      "D365 Finance & Operations Functional Consultant (item 4)",
      "D365 CRM Functional Consultant (item 5)",
    ]);
    expect(out.positions[0].experience).toBe("From the evaluation table.");
    expect(out.required_roles).toEqual(["Project Manager", "Functional Consultant"]);
  });

  it("drops what it cannot read rather than throwing", () => {
    const out = coerceTenderAi({
      submission_deadline: "31 February 2026",
      contract_start_date: "15 March 2026",
      min_experience_years: "five",
      positions: [{ quantity: 2 }, "nonsense", null],
      sectors: "Finance",
    });
    expect(out.submission_deadline).toBeNull();
    expect(out.contract_start_date).toBe("2026-03-15");
    expect(out.min_experience_years).toBeNull();
    expect(out.positions).toEqual([]);
    expect(out.sectors).toEqual([]);
    expect(coerceTenderAi(null).title).toBeNull();
    expect(coerceTenderAi("text").required_roles).toEqual([]);
  });
});

describe("endDateFrom", () => {
  it("counts a period from the start date to the day before it ends", () => {
    expect(endDateFrom("2026-04-01", 36)).toBe("2029-03-31");
    expect(endDateFrom("2026-01-15", 12)).toBe("2027-01-14");
  });

  it("is nothing without a start or a period", () => {
    expect(endDateFrom(null, 36)).toBeNull();
    expect(endDateFrom("2026-04-01", null)).toBeNull();
    expect(endDateFrom("not a date", 12)).toBeNull();
  });
});

describe("mergeTenderExtraction", () => {
  const local = {
    ...emptyTenderFields(),
    title: "Local title",
    reference_number: "REF-1",
    required_roles: ["Developer"],
    required_skills: ["Java"],
    min_experience_years: 3,
  };

  it("lets the model win where it answered and keeps the local value where it did not", () => {
    const merged = mergeTenderExtraction(local, {
      ...coerceTenderAi({}),
      title: "The tender's real title",
      contract_start_date: "2026-04-01",
      contract_duration_months: 24,
    });
    expect(merged.title).toBe("The tender's real title");
    expect(merged.reference_number).toBe("REF-1");
    expect(merged.required_roles).toEqual(["Developer"]);
    expect(merged.required_skills).toEqual(["Java"]);
    expect(merged.min_experience_years).toBe(3);
    // A period becomes an end date.
    expect(merged.contract_end_date).toBe("2028-03-31");
    expect(merged.positions).toBeUndefined();
    // The local parser has no brief; the model's is carried, and nothing when it gave none.
    expect(merged.summary).toBeNull();
    expect(mergeTenderExtraction(local, { ...coerceTenderAi({}), summary: "A brief." }).summary).toBe("A brief.");
  });

  it("carries the model's positions, which the heuristics have no notion of", () => {
    const ai = coerceTenderAi({
      positions: [{ role: "Business Analyst", quantity: 2, min_experience_years: 5, required_skills: ["BPMN"], required_certifications: [], required_qualifications: [], notes: null }],
    });
    const merged = mergeTenderExtraction(local, ai);
    expect(merged.positions).toHaveLength(1);
    expect(merged.required_roles).toEqual(["Business Analyst"]);
    // Once the model has read the roles, its silence on a tender-wide
    // minimum is the answer; the local "11+ years" off a points table is not.
    expect(merged.min_experience_years).toBeNull();
    expect(mergeTenderExtraction(local, { ...ai, min_experience_years: 4 }).min_experience_years).toBe(4);
  });
});
