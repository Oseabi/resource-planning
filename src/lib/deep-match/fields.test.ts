import { describe, it, expect } from "vitest";
import {
  AI_RERANK_N,
  DEEP_MATCH_SCHEMA,
  buildDeepMatchPrompt,
  buildDeepMatchBody,
  coerceDeepMatch,
  deepMatchNote,
  deepMatchUpdate,
  parseDeepMatchNote,
  type DeepMatchCandidate,
  type DeepMatchSeat,
} from "@/lib/deep-match/fields";
import { isStrictSchema } from "@/lib/extraction/ai-fields";

const seat: DeepMatchSeat = {
  role: "Business Analyst",
  requiredSkills: ["Business Analysis", "BPMN"],
  requiredCertifications: ["PMP"],
  minExperienceYears: 5,
  notes: "Must have worked on a public sector ERP rollout.",
};

const candidate = (over: Partial<DeepMatchCandidate> = {}): DeepMatchCandidate => ({
  index: 1,
  currentRole: "Senior Business Analyst",
  additionalRoles: ["Product Owner"],
  skills: ["Business Analysis"],
  technicalSkills: ["BPMN", "ARIS"],
  certifications: ["PMP"],
  yearsExperience: 9,
  availability: "notice_period",
  score: 88,
  ...over,
});

describe("the request", () => {
  it("matches the schema dialect Groq's strict mode accepts", () => {
    expect(isStrictSchema(DEEP_MATCH_SCHEMA)).toEqual([]);
  });

  it("names candidates by number only, never by name or id", () => {
    const prompt = buildDeepMatchPrompt(seat, [candidate(), candidate({ index: 2, currentRole: "BA" })]);
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("[2]");
    // A uuid is wasted tokens, and an index cannot be hallucinated into
    // another person's match row.
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("tells the model the score is context it may not change", () => {
    const prompt = buildDeepMatchPrompt(seat, [candidate()]);
    expect(prompt).toContain("may not change the score");
    expect(prompt).toContain("Never invent");
  });

  it("carries the seat's requirements and the candidate's own lists", () => {
    const prompt = buildDeepMatchPrompt(seat, [candidate()]);
    expect(prompt).toContain("Business Analysis");
    expect(prompt).toContain("PMP");
    expect(prompt).toContain("public sector ERP rollout");
    expect(prompt).toContain("ARIS");
    expect(prompt).toContain("score: 88");
  });

  it("stays deterministic and inside the per-minute budget", () => {
    const body = buildDeepMatchBody(seat, [candidate(), candidate({ index: 2 })]);
    expect(body.temperature).toBe(0);
    expect(body.max_completion_tokens).toBe(1200);
    const content = String((body.messages as { content: string }[])[0].content);
    // Roughly four characters a token, the calibration ai-fields.ts records.
    expect(content.length / 4).toBeLessThan(2500);
  });

  it("redacts contact details that strayed into a structured field", () => {
    const body = buildDeepMatchBody(seat, [
      candidate({ skills: ["Business Analysis", "reach me on nomsa@example.co.za"] }),
    ]);
    const content = String((body.messages as { content: string }[])[0].content);
    expect(content).not.toContain("nomsa@example.co.za");
    expect(content).toContain("[email removed]");
  });
});

describe("reading the answer", () => {
  it("keeps a well-formed ranking in the order it asked for", () => {
    const entries = coerceDeepMatch(
      {
        ranking: [
          { candidate: 2, rank: 1, reason: "Ran the ERP rollout.", confidence: "high" },
          { candidate: 1, rank: 2, reason: "Strong on paper.", confidence: "medium" },
        ],
      },
      2,
    );
    expect(entries.map((e) => e.candidate)).toEqual([2, 1]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2]);
  });

  it("drops an index outside what was sent rather than clamping it", () => {
    // Clamping would attribute one person's reason to another, which is the
    // one thing this must never do.
    const entries = coerceDeepMatch(
      { ranking: [{ candidate: 9, rank: 1, reason: "x", confidence: "high" }] },
      3,
    );
    expect(entries).toEqual([]);
  });

  it("keeps the first of a repeated index", () => {
    const entries = coerceDeepMatch(
      {
        ranking: [
          { candidate: 1, rank: 1, reason: "first", confidence: "high" },
          { candidate: 1, rank: 2, reason: "second", confidence: "low" },
        ],
      },
      2,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("first");
  });

  it("renumbers a muddled rank so the order still reads", () => {
    const entries = coerceDeepMatch(
      {
        ranking: [
          { candidate: 1, rank: 1, reason: "a", confidence: "high" },
          { candidate: 2, rank: 1, reason: "b", confidence: "high" },
          { candidate: 3, rank: 3, reason: "c", confidence: "high" },
        ],
      },
      3,
    );
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("never throws on rubbish", () => {
    for (const v of [null, undefined, {}, [], "no", { ranking: "no" }, { ranking: [null, 3] }]) {
      expect(() => coerceDeepMatch(v, 5)).not.toThrow();
      expect(coerceDeepMatch(v, 5)).toEqual([]);
    }
  });

  it("falls back to low confidence rather than inventing one", () => {
    const entries = coerceDeepMatch(
      { ranking: [{ candidate: 1, rank: 1, reason: "x", confidence: "certain" }] },
      1,
    );
    expect(entries[0].confidence).toBe("low");
  });

  it("truncates a rambling reason", () => {
    const entries = coerceDeepMatch(
      { ranking: [{ candidate: 1, rank: 1, reason: "x".repeat(2000), confidence: "high" }] },
      1,
    );
    expect(entries[0].reason.length).toBeLessThanOrEqual(400);
  });
});

describe("what gets written", () => {
  it("can only ever write the notes column", () => {
    // The guarantee that an opinion cannot reach the score, by construction
    // and not by review.
    const update = deepMatchUpdate("note");
    expect(Object.keys(update)).toEqual(["ai_deep_match_notes"]);
  });

  it("round trips through the stored envelope", () => {
    const note = deepMatchNote({ candidate: 2, rank: 1, reason: "Ran the rollout.", confidence: "high" }, 5, "m");
    const parsed = parseDeepMatchNote(note);
    expect(parsed).toMatchObject({ reason: "Ran the rollout.", rank: 1, of: 5, confidence: "high", model: "m" });
    expect(parsed?.at).not.toBe("");
  });

  it("reads something somebody typed in the column by hand", () => {
    // The column is text and predates this feature, so the reader has to cope
    // with anything already in it rather than throw.
    expect(parseDeepMatchNote("just a sentence")).toMatchObject({ reason: "just a sentence", rank: 0 });
    expect(parseDeepMatchNote(null)).toBeNull();
    expect(parseDeepMatchNote("   ")).toBeNull();
    expect(parseDeepMatchNote("{bad json")).toMatchObject({ reason: "{bad json" });
  });

  it("ranks the five the screen already shows", () => {
    expect(AI_RERANK_N).toBe(5);
  });
});
