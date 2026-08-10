import { describe, it, expect } from "vitest";
import {
  positionToScoringInput,
  fillSummary,
  seatCount,
  cleanPositions,
  isUsablePosition,
  EMPTY_POSITION,
  type PositionInput,
} from "@/lib/positions";
import { scoreCandidateForPosition, positionCoverage } from "@/lib/matching";

function position(over: Partial<PositionInput> & { id?: string } = {}): PositionInput & { id: string } {
  return {
    id: "p1",
    role: "Business Analyst",
    quantity: 1,
    min_experience_years: null,
    required_skills: [],
    required_certifications: [],
    ...over,
  } as PositionInput & { id: string };
}

const candidate = {
  current_role: "Business Analyst",
  additional_roles: [],
  skills: ["Business Process Analysis"],
  technical_skills: [],
  certifications: [],
  years_experience: 4,
  availability: "available" as const,
};

describe("seatCount", () => {
  it("defaults a missing or invalid quantity to one seat", () => {
    expect(seatCount({ quantity: null })).toBe(1);
    expect(seatCount({ quantity: 0 })).toBe(1);
    expect(seatCount({ quantity: -3 })).toBe(1);
  });
  it("floors fractional quantities, seats are whole people", () => {
    expect(seatCount({ quantity: 2.7 })).toBe(2);
  });
});

describe("positionToScoringInput", () => {
  it("maps a position onto the scoring engine's criteria", () => {
    const input = positionToScoringInput(
      position({ role: "Project Manager", min_experience_years: 3, required_skills: ["Agile"] }),
    );
    expect(input).toMatchObject({
      required_role: "Project Manager",
      min_experience_years: 3,
      required_skills: ["Agile"],
    });
  });

  it("treats a blank role as no role requirement", () => {
    expect(positionToScoringInput(position({ role: "   " })).required_role).toBeNull();
  });

  it("normalises an unknown availability to null", () => {
    expect(
      positionToScoringInput(position({ required_availability: "whenever" })).required_availability,
    ).toBeNull();
  });
});

describe("scoreCandidateForPosition", () => {
  it("scores each seat on its own experience floor", () => {
    const lenient = scoreCandidateForPosition(candidate, position({ min_experience_years: 3 }));
    const strict = scoreCandidateForPosition(candidate, position({ min_experience_years: 8 }));
    // 4 years clears a 3-year floor but only half-clears an 8-year one.
    expect(lenient.breakdown.experience).toBe(1);
    expect(strict.breakdown.experience).toBe(0.5);
    expect(strict.total).toBeLessThan(lenient.total);
  });

  it("scores each seat on its own skills, not a shared pool", () => {
    const matching = scoreCandidateForPosition(
      candidate,
      position({ required_skills: ["Business Process Analysis"] }),
    );
    const unrelated = scoreCandidateForPosition(
      candidate,
      position({ required_skills: ["Kubernetes"] }),
    );
    expect(matching.breakdown.skills).toBe(1);
    expect(unrelated.breakdown.skills).toBe(0);
  });
});

describe("fillSummary", () => {
  const positions = [position({ id: "a", quantity: 2 }), position({ id: "b", quantity: 3 })];

  it("counts seats and fills across every position", () => {
    const summary = fillSummary(positions, [
      { position_id: "a" },
      { position_id: "b" },
      { position_id: "b" },
    ]);
    expect(summary.totalSeats).toBe(5);
    expect(summary.filledSeats).toBe(3);
    expect(summary.percent).toBe(60);
  });

  it("reports remaining seats and fullness per position", () => {
    const summary = fillSummary(positions, [{ position_id: "a" }, { position_id: "a" }]);
    const a = summary.perPosition.find((p) => p.positionId === "a")!;
    const b = summary.perPosition.find((p) => p.positionId === "b")!;
    expect(a).toMatchObject({ filled: 2, remaining: 0, isFull: true });
    expect(b).toMatchObject({ filled: 0, remaining: 3, isFull: false });
  });

  it("does not let an over-filled position mask a gap elsewhere", () => {
    const summary = fillSummary(positions, [
      { position_id: "a" },
      { position_id: "a" },
      { position_id: "a" }, // 3 on a 2-seat line
    ]);
    expect(summary.filledSeats).toBe(2); // capped, so b's 3 seats still read as open
    expect(summary.percent).toBe(40);
  });

  it("is 0% rather than NaN when nothing is defined yet", () => {
    expect(fillSummary([], [])).toMatchObject({ totalSeats: 0, filledSeats: 0, percent: 0 });
  });
});

describe("positionCoverage", () => {
  it("flags an unfilled position that nobody can staff as a gap", () => {
    const coverage = positionCoverage(
      [candidate],
      [position({ id: "a", role: "Business Analyst" }), position({ id: "b", role: "Neurosurgeon" })],
      [],
    );
    const byId = Object.fromEntries(coverage.map((c) => [c.positionId, c]));
    expect(byId["a"].strongMatches).toBe(1);
    expect(byId["a"].isGap).toBe(false);
    expect(byId["b"].strongMatches).toBe(0);
    expect(byId["b"].isGap).toBe(true);
  });

  it("stops calling a position a gap once its seats are filled", () => {
    const coverage = positionCoverage([candidate], [position({ id: "b", role: "Neurosurgeon" })], [
      { position_id: "b" },
    ]);
    expect(coverage[0]).toMatchObject({ filled: 1, remaining: 0, isGap: false });
  });
});

describe("cleanPositions", () => {
  it("drops lines the user never filled in", () => {
    expect(isUsablePosition(EMPTY_POSITION)).toBe(false);
    const cleaned = cleanPositions([position({ role: "  Project Manager  " }), { ...EMPTY_POSITION }]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].role).toBe("Project Manager");
  });

  it("repairs an invalid quantity on the way through", () => {
    expect(cleanPositions([position({ quantity: 0 })])[0].quantity).toBe(1);
  });
});
