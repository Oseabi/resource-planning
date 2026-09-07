import { describe, it, expect } from "vitest";
import {
  isContactable,
  eligibleLetters,
  letterCoverage,
  coverageLabel,
  type ReferenceLetterFacts,
} from "@/lib/reference-letters";

const FROM = "2026-09-07";

const letter = (over: Partial<ReferenceLetterFacts> = {}): ReferenceLetterFacts => ({
  id: "l1",
  client: "Eskom Holdings",
  contract_value: 12_000_000,
  work_completed_on: "2025-06-30",
  sectors: ["Public Sector"],
  contact_name: "T Ndlovu",
  contact_email: "t.ndlovu@eskom.co.za",
  contact_phone: null,
  ...over,
});

describe("isContactable", () => {
  it("needs a way to actually reach the signatory", () => {
    expect(isContactable(letter())).toBe(true);
    expect(isContactable(letter({ contact_email: null, contact_phone: "011 555 0100" }))).toBe(true);
  });

  it("a name alone is not contactable", () => {
    // Tenders ask for contactable references. A name with no number or address
    // cannot be followed up, so it does not answer the requirement.
    expect(isContactable(letter({ contact_email: null, contact_phone: null }))).toBe(false);
    expect(isContactable(letter({ contact_email: "   ", contact_phone: "  " }))).toBe(false);
  });
});

describe("eligibleLetters", () => {
  it("drops work finished outside the window", () => {
    const recent = letter({ id: "recent", work_completed_on: "2024-01-01" });
    const old = letter({ id: "old", work_completed_on: "2019-01-01" });
    const kept = eligibleLetters([recent, old], { withinYears: 5, from: FROM });
    expect(kept.map((l) => l.id)).toEqual(["recent"]);
  });

  it("keeps a letter whose completion date was never recorded", () => {
    // Not recording the date is a gap in our own data. Discarding the letter
    // over it would understate what the business can actually put forward.
    const undated = letter({ id: "undated", work_completed_on: null });
    expect(eligibleLetters([undated], { withinYears: 5, from: FROM }).map((l) => l.id)).toEqual(["undated"]);
  });

  it("drops work below a value floor, and keeps unpriced work", () => {
    const big = letter({ id: "big", contract_value: 20_000_000 });
    const small = letter({ id: "small", contract_value: 200_000 });
    const unpriced = letter({ id: "unpriced", contract_value: null });
    const kept = eligibleLetters([big, small, unpriced], { minValue: 5_000_000, from: FROM });
    expect(kept.map((l) => l.id)).toEqual(["big", "unpriced"]);
  });

  it("keeps everything when no filter is asked for", () => {
    expect(eligibleLetters([letter(), letter({ id: "l2" })], { from: FROM })).toHaveLength(2);
  });
});

describe("letterCoverage", () => {
  it("reports met when there are enough contactable letters", () => {
    const c = letterCoverage(2, [letter({ id: "a" }), letter({ id: "b" })]);
    expect(c).toMatchObject({ state: "met", required: 2, onFile: 2, shortfall: 0 });
  });

  it("counts the shortfall on contactable letters only", () => {
    // Three on file but one with no contact details answers a two-letter
    // requirement; make it two uncontactable and the bid is short.
    const c = letterCoverage(2, [
      letter({ id: "a" }),
      letter({ id: "b", contact_email: null, contact_phone: null }),
      letter({ id: "c", contact_email: null, contact_phone: null }),
    ]);
    expect(c).toMatchObject({ state: "short", onFile: 3, uncontactable: 2, shortfall: 1 });
  });

  it("says unknown when nobody has read the requirement off the RFQ", () => {
    // Not the same as met. Reporting a bid compliant on a blank would be the
    // system asserting something it was never told.
    const c = letterCoverage(null, [letter()]);
    expect(c.state).toBe("unknown");
    expect(c.shortfall).toBe(0);
  });

  it("handles a tender that genuinely asks for none", () => {
    // Zero is a real answer and has to stay distinct from blank.
    expect(letterCoverage(0, []).state).toBe("met");
  });

  it("reports the whole requirement as short when nothing is on file", () => {
    expect(letterCoverage(3, [])).toMatchObject({ state: "short", onFile: 0, shortfall: 3 });
  });
});

describe("coverageLabel", () => {
  it("reads plainly in each state", () => {
    expect(coverageLabel(letterCoverage(3, [letter({ id: "a" }), letter({ id: "b" }), letter({ id: "c" })])))
      .toBe("3 needed, 3 on file");
    expect(coverageLabel(letterCoverage(3, [letter()]))).toBe("3 needed, 2 short");
    expect(coverageLabel(letterCoverage(null, [letter()])))
      .toBe("1 reference letter on file, and no requirement recorded for this tender");
  });
});
