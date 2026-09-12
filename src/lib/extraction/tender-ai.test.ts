import { describe, it, expect } from "vitest";
import {
  TENDER_SCHEMA,
  buildTenderPrompt,
  coerceTenderAi,
  mergeTenderExtraction,
  endDateFrom,
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
  });
});

describe("buildTenderPrompt", () => {
  it("carries the exact role spellings matching scores on, and tells the model not to guess", () => {
    const prompt = buildTenderPrompt();
    expect(prompt).toContain("Business Analyst");
    expect(prompt).toMatch(/Never guess/);
    expect(prompt).toContain("YYYY-MM-DD");
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
      value: 4500000,
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
    expect(out.positions[1].required_certifications).toEqual(["PMP"]);
    expect(out.required_roles).toEqual(["Business Analyst", "Project Manager"]);
    expect(out.contract_duration_months).toBe(36);
    expect(out.reference_letters_required).toBe(3);
  });

  it("drops what it cannot read rather than throwing", () => {
    const out = coerceTenderAi({
      value: "R 2.5 million",
      submission_deadline: "31 February 2026",
      contract_start_date: "15 March 2026",
      min_experience_years: "five",
      positions: [{ quantity: 2 }, "nonsense", null],
      sectors: "Finance",
    });
    expect(out.value).toBe(2_500_000);
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
  });

  it("carries the model's positions, which the heuristics have no notion of", () => {
    const ai = coerceTenderAi({
      positions: [{ role: "Business Analyst", quantity: 2, min_experience_years: 5, required_skills: ["BPMN"], required_certifications: [], required_qualifications: [], notes: null }],
    });
    const merged = mergeTenderExtraction(local, ai);
    expect(merged.positions).toHaveLength(1);
    expect(merged.required_roles).toEqual(["Business Analyst"]);
  });
});
