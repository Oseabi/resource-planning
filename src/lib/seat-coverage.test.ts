import { describe, it, expect } from "vitest";
import { seatCoverage, type SeatDemand } from "@/lib/seat-coverage";
import type { CandidateAvailability, PlacementWindow } from "@/lib/availability";

const START = "2027-01-01";

const seat = (positionId: string, role: string, quantity: number, ids: string[]): SeatDemand => ({
  positionId,
  role,
  quantity,
  matches: ids.map((candidateId) => ({ candidateId, score: 85 })),
});

const person = (id: string, availableFrom: string | null = null): CandidateAvailability => ({
  id,
  available_from: availableFrom,
});

const placement = (
  candidate_id: string,
  start_date: string,
  end_date: string | null,
): PlacementWindow => ({ candidate_id, start_date, end_date });

describe("seatCoverage", () => {
  it("returns an empty summary when there are no seats", () => {
    const r = seatCoverage({ seats: [], candidates: [], placements: [], startDate: START });
    expect(r.perSeat).toEqual([]);
    expect(r.totalNeeded).toBe(0);
    expect(r.totalShortfall).toBe(0);
    expect(r.gaps).toEqual([]);
  });

  it("reports the whole seat as short when nobody is scored against it", () => {
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 3, [])],
      candidates: [person("a")],
      placements: [],
      startDate: START,
    });
    expect(r.perSeat[0].qualified).toBe(0);
    expect(r.perSeat[0].shortfall).toBe(3);
  });

  it("counts only matches at or above the threshold", () => {
    const r = seatCoverage({
      seats: [
        {
          positionId: "p1",
          role: "Business Analyst",
          quantity: 3,
          matches: [
            { candidateId: "a", score: 70 }, // exactly the threshold, counts
            { candidateId: "b", score: 69 }, // just under, does not
            { candidateId: "c", score: 92 },
          ],
        },
      ],
      candidates: [person("a"), person("b"), person("c")],
      placements: [],
      startDate: START,
    });
    expect(r.perSeat[0].qualified).toBe(2);
    expect(r.perSeat[0].free).toBe(2);
  });

  it("counts someone whose current contract ends before the start date as free", () => {
    // The most important behaviour here. The question is about January, so
    // someone finishing in November is available for it. Asking about today
    // instead would hold back exactly the people the question is about.
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 1, ["a"])],
      candidates: [person("a")],
      placements: [placement("a", "2026-01-01", "2026-11-30")],
      startDate: START,
    });
    expect(r.perSeat[0].free).toBe(1);
    expect(r.perSeat[0].committedHard).toBe(0);
    expect(r.totalShortfall).toBe(0);
  });

  it("counts someone still committed past the start date as unavailable", () => {
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 1, ["a"])],
      candidates: [person("a")],
      placements: [placement("a", "2026-01-01", "2027-06-30")],
      startDate: START,
    });
    expect(r.perSeat[0].free).toBe(0);
    expect(r.perSeat[0].committedHard).toBe(1);
    expect(r.perSeat[0].shortfall).toBe(1);
  });

  it("reports an open-ended commitment as unknown rather than free", () => {
    // Counting them either way would be a guess presented as a fact. Reported
    // separately because a high count means missing contract end dates, which
    // is a data problem rather than a resourcing one.
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 1, ["a"])],
      candidates: [person("a")],
      placements: [placement("a", "2026-01-01", null)],
      startDate: START,
    });
    expect(r.perSeat[0].unknown).toBe(1);
    expect(r.perSeat[0].free).toBe(0);
    expect(r.perSeat[0].committedHard).toBe(0);
  });

  it("separates someone promised to another bid from someone genuinely free", () => {
    // A promise to another bid can be revisited by a person. A running contract
    // cannot, so the two must not read the same.
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 2, ["a", "b"])],
      candidates: [person("a"), person("b")],
      placements: [],
      softCommitments: ["b"],
      startDate: START,
    });
    expect(r.perSeat[0].free).toBe(1);
    expect(r.perSeat[0].committedSoft).toBe(1);
    expect(r.perSeat[0].softCandidateIds).toEqual(["b"]);
    expect(r.perSeat[0].shortfall).toBe(1);
  });

  it("respects an available_from later than the contract start", () => {
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 1, ["a"])],
      candidates: [person("a", "2027-03-01")],
      placements: [],
      startDate: START,
    });
    expect(r.perSeat[0].free).toBe(0);
    expect(r.perSeat[0].committedHard).toBe(1);
  });

  it("never reports a negative shortfall", () => {
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 1, ["a", "b", "c"])],
      candidates: [person("a"), person("b"), person("c")],
      placements: [],
      startDate: START,
    });
    expect(r.perSeat[0].free).toBe(3);
    expect(r.perSeat[0].shortfall).toBe(0);
    expect(r.totalShortfall).toBe(0);
  });

  it("does not count one person as filling two seats at once", () => {
    // Per seat they are free for both, which is true. Summing those counts says
    // two people are available for two seats, which is not.
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 1, ["a"]), seat("p2", "Data Analyst", 1, ["a"])],
      candidates: [person("a")],
      placements: [],
      startDate: START,
    });
    expect(r.perSeat[0].free).toBe(1);
    expect(r.perSeat[1].free).toBe(1);
    expect(r.totalFreeBySeat).toBe(2);
    expect(r.distinctFreeCandidates).toBe(1);
    expect(r.totalNeeded).toBe(2);
    expect(r.totalShortfall).toBe(1);
  });

  it("skips a scored candidate who is no longer in the candidate set", () => {
    // Match rows outlive the people they scored, and a stale one must not be
    // counted as somebody available.
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 1, ["ghost"])],
      candidates: [],
      placements: [],
      startDate: START,
    });
    expect(r.perSeat[0].qualified).toBe(1);
    expect(r.perSeat[0].free).toBe(0);
    expect(r.perSeat[0].shortfall).toBe(1);
  });

  it("orders the gaps worst first", () => {
    const r = seatCoverage({
      seats: [seat("p1", "Business Analyst", 1, []), seat("p2", "Data Engineer", 4, [])],
      candidates: [],
      placements: [],
      startDate: START,
    });
    expect(r.gaps.map((g) => g.role)).toEqual(["Data Engineer", "Business Analyst"]);
  });
});
