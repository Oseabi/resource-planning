import { describe, it, expect } from "vitest";
import {
  deliveryState,
  contractWindowLabel,
  placementsAlignedTo,
  validateExtension,
  validatePlacementWindow,
  type ContractWindow,
} from "@/lib/delivery";

/** Pinned, so a test cannot start passing or failing because of the date today. */
const FROM = "2026-08-10";

const won = (start: string | null, end: string | null): ContractWindow => ({
  status: "won",
  contract_start_date: start,
  contract_end_date: end,
});

describe("deliveryState", () => {
  it("says nothing about a bid that was not won", () => {
    // Delivery is a question about a contract, and a bid that has not been
    // awarded does not have one yet.
    for (const status of ["draft", "live", "submitted", "lost"]) {
      const tender = { ...won("2026-01-01", "2026-12-31"), status };
      expect(deliveryState(tender, FROM)).toBeNull();
    }
  });

  it("says nothing when the contract start was never recorded", () => {
    // A blank prompts someone to fill the date in. A guess would not.
    expect(deliveryState(won(null, "2026-12-31"), FROM)).toBeNull();
  });

  it("reads a contract starting later as awarded", () => {
    expect(deliveryState(won("2026-09-01", "2027-08-31"), FROM)).toBe("awarded");
  });

  it("reads today as the first day of delivery", () => {
    expect(deliveryState(won(FROM, "2027-08-31"), FROM)).toBe("in_delivery");
  });

  it("reads a contract mid-term as in delivery", () => {
    expect(deliveryState(won("2026-01-01", "2027-08-31"), FROM)).toBe("in_delivery");
  });

  it("counts the last day as still in delivery", () => {
    // People are on site on the closing day, so the contract is running.
    expect(deliveryState(won("2026-01-01", FROM), FROM)).toBe("in_delivery");
  });

  it("reads a contract that ended yesterday as completed", () => {
    expect(deliveryState(won("2026-01-01", "2026-08-09"), FROM)).toBe("completed");
  });

  it("reads a started contract with no end date as in delivery", () => {
    // Open ended is running until told otherwise, never finished.
    expect(deliveryState(won("2026-01-01", null), FROM)).toBe("in_delivery");
  });
});

describe("contractWindowLabel", () => {
  it("reads both dates as a range", () => {
    expect(contractWindowLabel("2026-10-01", "2027-09-30")).toBe("1 Oct 2026 to 30 Sep 2027");
  });

  it("says an open-ended contract is open ended", () => {
    expect(contractWindowLabel("2026-10-01", null)).toBe("From 1 Oct 2026, open ended");
  });

  it("says so when neither date is set", () => {
    expect(contractWindowLabel(null, null)).toBe("No contract dates set");
  });
});

describe("placementsAlignedTo", () => {
  const rows = [
    { id: "a", end_date: "2027-09-30" },
    { id: "b", end_date: "2027-09-30" },
    { id: "c", end_date: "2027-03-31" },
    { id: "d", end_date: null },
  ];

  it("takes only the placements that matched the old contract end", () => {
    const { aligned, overridden } = placementsAlignedTo(rows, "2027-09-30");
    expect(aligned.map((r) => r.id)).toEqual(["a", "b"]);
    // c left early on purpose and d is open ended, so neither follows the contract.
    expect(overridden.map((r) => r.id)).toEqual(["c", "d"]);
  });

  it("aligns nothing when the contract had no end date", () => {
    // This is not an extension, it is dating the contract for the first time.
    // Converting open-ended commitments into dated ones under the word
    // "extended" would be a quiet change nobody asked for.
    const { aligned, overridden } = placementsAlignedTo(rows, null);
    expect(aligned).toEqual([]);
    expect(overridden).toHaveLength(4);
  });

  it("handles a contract with no placements", () => {
    expect(placementsAlignedTo([], "2027-09-30")).toEqual({ aligned: [], overridden: [] });
  });
});

describe("validateExtension", () => {
  it("accepts a date after the current end", () => {
    expect(validateExtension(won("2026-01-01", "2027-09-30"), "2028-09-30")).toBeNull();
  });

  it("rejects a date that does not move the contract forward", () => {
    expect(validateExtension(won("2026-01-01", "2027-09-30"), "2027-09-30")).toMatch(/later/);
    expect(validateExtension(won("2026-01-01", "2027-09-30"), "2027-01-01")).toMatch(/later/);
  });

  it("rejects a date before the contract even starts", () => {
    expect(validateExtension(won("2026-01-01", null), "2025-06-30")).toMatch(/before the contract/);
  });

  it("rejects an empty date and a bid that was not won", () => {
    expect(validateExtension(won("2026-01-01", "2027-09-30"), "")).toMatch(/Pick/);
    expect(
      validateExtension({ ...won("2026-01-01", "2027-09-30"), status: "live" }, "2028-09-30"),
    ).toMatch(/won contract/);
  });

  it("accepts dating a contract that had no end", () => {
    expect(validateExtension(won("2026-01-01", null), "2027-09-30")).toBeNull();
  });
});

describe("validatePlacementWindow", () => {
  it("accepts an open-ended window and a well-ordered one", () => {
    expect(validatePlacementWindow("2026-10-01", null)).toBeNull();
    expect(validatePlacementWindow("2026-10-01", "2027-09-30")).toBeNull();
    expect(validatePlacementWindow("2026-10-01", "2026-10-01")).toBeNull();
  });

  it("rejects a window that ends before it starts", () => {
    // The database constraint would reject this too, but its message is not a
    // sentence to put in front of a user.
    expect(validatePlacementWindow("2026-10-01", "2026-09-30")).toMatch(/before the start/);
    expect(validatePlacementWindow("", null)).toMatch(/Pick/);
  });
});
