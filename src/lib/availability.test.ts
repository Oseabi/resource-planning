import { describe, it, expect } from "vitest";
import {
  availableFrom,
  isFreeBy,
  benchForecast,
  availabilityLabel,
  formatDate,
  INDEFINITE,
  type PlacementWindow,
} from "@/lib/availability";

const FROM = "2026-08-10";

function candidate(id: string, available_from: string | null = null) {
  return { id, available_from };
}

function placement(
  candidate_id: string,
  start_date: string,
  end_date: string | null,
): PlacementWindow {
  return { candidate_id, start_date, end_date };
}

describe("availableFrom", () => {
  it("is free now with no placements and no override", () => {
    expect(availableFrom(candidate("a"), [], FROM)).toBe(null);
  });

  it("returns the end date of a running placement", () => {
    const placements = [placement("a", "2026-01-01", "2026-11-30")];
    expect(availableFrom(candidate("a"), placements, FROM)).toBe("2026-11-30");
  });

  it("is INDEFINITE when a placement has no end date", () => {
    const placements = [placement("a", "2026-01-01", null)];
    expect(availableFrom(candidate("a"), placements, FROM)).toBe(INDEFINITE);
  });

  it("lets an open-ended placement win over a dated one", () => {
    // Committed with no end in sight cannot be softened by another contract
    // that happens to have a date on it.
    const placements = [
      placement("a", "2026-01-01", "2026-09-30"),
      placement("a", "2026-02-01", null),
    ];
    expect(availableFrom(candidate("a"), placements, FROM)).toBe(INDEFINITE);
  });

  it("takes the latest end date when several overlap", () => {
    const placements = [
      placement("a", "2026-01-01", "2026-09-30"),
      placement("a", "2026-03-01", "2027-02-28"),
      placement("a", "2026-02-01", "2026-12-31"),
    ];
    expect(availableFrom(candidate("a"), placements, FROM)).toBe("2027-02-28");
  });

  it("ignores placements that have already ended", () => {
    // No tidying required: a finished contract should not hold someone back.
    const placements = [placement("a", "2025-01-01", "2026-06-30")];
    expect(availableFrom(candidate("a"), placements, FROM)).toBe(null);
  });

  it("ignores other people's placements", () => {
    const placements = [placement("b", "2026-01-01", "2026-11-30")];
    expect(availableFrom(candidate("a"), placements, FROM)).toBe(null);
  });

  it("honours a manual override later than any placement", () => {
    const placements = [placement("a", "2026-01-01", "2026-09-30")];
    expect(availableFrom(candidate("a", "2026-12-01"), placements, FROM)).toBe("2026-12-01");
  });

  it("ignores a manual override already in the past", () => {
    expect(availableFrom(candidate("a", "2026-01-01"), [], FROM)).toBe(null);
  });

  it("lets a placement outlast an earlier override", () => {
    const placements = [placement("a", "2026-01-01", "2027-03-31")];
    expect(availableFrom(candidate("a", "2026-09-01"), placements, FROM)).toBe("2027-03-31");
  });
});

describe("isFreeBy", () => {
  it("counts someone free now as free by any date", () => {
    expect(isFreeBy(null, "2026-09-01")).toBe(true);
  });

  it("never counts an indefinite commitment as free", () => {
    expect(isFreeBy(INDEFINITE, "2099-01-01")).toBe(false);
  });

  it("includes the boundary date itself", () => {
    expect(isFreeBy("2026-11-30", "2026-11-30")).toBe(true);
    expect(isFreeBy("2026-12-01", "2026-11-30")).toBe(false);
  });
});

describe("benchForecast", () => {
  it("counts people already free in every month", () => {
    const forecast = benchForecast([candidate("a"), candidate("b")], [], 3, FROM);
    expect(forecast.map((m) => m.cumulative)).toEqual([2, 2, 2]);
    expect(forecast[0].freeing).toEqual([]);
  });

  it("places each person in the month they come free and accumulates", () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const placements = [
      placement("a", "2026-01-01", "2026-09-15"),
      placement("b", "2026-01-01", "2026-10-31"),
      // c is free now.
    ];
    const forecast = benchForecast(candidates, placements, 3, FROM);

    expect(forecast.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(forecast[0].freeing).toEqual([]);
    expect(forecast[1].freeing).toEqual([{ id: "a", date: "2026-09-15" }]);
    expect(forecast[2].freeing).toEqual([{ id: "b", date: "2026-10-31" }]);
    // c from the start, then a, then b.
    expect(forecast.map((m) => m.cumulative)).toEqual([1, 2, 3]);
  });

  it("excludes indefinite commitments from every month", () => {
    const candidates = [candidate("a"), candidate("b")];
    const placements = [placement("a", "2026-01-01", null)];
    const forecast = benchForecast(candidates, placements, 2, FROM);
    expect(forecast.map((m) => m.cumulative)).toEqual([1, 1]);
    expect(forecast.flatMap((m) => m.freeing)).toEqual([]);
  });

  it("leaves out anyone freeing beyond the window", () => {
    const placements = [placement("a", "2026-01-01", "2027-06-30")];
    const forecast = benchForecast([candidate("a")], placements, 3, FROM);
    expect(forecast.map((m) => m.cumulative)).toEqual([0, 0, 0]);
  });

  it("rolls over the year boundary", () => {
    const forecast = benchForecast([], [], 4, "2026-11-15");
    expect(forecast.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(forecast.map((m) => m.label)).toEqual([
      "Nov 2026",
      "Dec 2026",
      "Jan 2027",
      "Feb 2027",
    ]);
  });

  it("sorts several people freeing in the same month by date", () => {
    const candidates = [candidate("a"), candidate("b")];
    const placements = [
      placement("a", "2026-01-01", "2026-09-28"),
      placement("b", "2026-01-01", "2026-09-04"),
    ];
    const forecast = benchForecast(candidates, placements, 2, FROM);
    expect(forecast[1].freeing.map((f) => f.id)).toEqual(["b", "a"]);
  });
});

describe("formatDate and availabilityLabel", () => {
  it("formats without timezone drift", () => {
    // Parsing this into a Date and reading it back can land on 31 October.
    expect(formatDate("2026-11-01")).toBe("1 Nov 2026");
  });

  it("distinguishes free now, a date, and no end date", () => {
    expect(availabilityLabel(null)).toBe("Free now");
    expect(availabilityLabel("2026-11-30")).toBe("Free from 30 Nov 2026");
    expect(availabilityLabel(INDEFINITE)).toBe("Committed, no end date");
  });
});
