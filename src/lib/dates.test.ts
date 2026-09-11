import { describe, it, expect } from "vitest";
import { parseLongDate, formatLongDate } from "@/lib/dates";

describe("parseLongDate", () => {
  it("reads the template's own format", () => {
    expect(parseLongDate("05 February 1989")).toBe("1989-02-05");
    expect(parseLongDate("07 September 2026")).toBe("2026-09-07");
  });

  it("reads a single-digit day, an abbreviated month and an ordinal", () => {
    expect(parseLongDate("5 Feb 1989")).toBe("1989-02-05");
    expect(parseLongDate("5th February, 1989")).toBe("1989-02-05");
  });

  it("reads the month-first form some export tools write", () => {
    expect(parseLongDate("February 5, 1989")).toBe("1989-02-05");
  });

  it("accepts a value already in ISO, since stored values come back that way", () => {
    expect(parseLongDate("1989-02-05")).toBe("1989-02-05");
  });

  it("refuses a day the calendar does not have", () => {
    expect(parseLongDate("31 February 1989")).toBeNull();
    expect(parseLongDate("2026-02-30")).toBeNull();
  });

  it("refuses rather than guessing at anything else", () => {
    // 01/03/1989 is the 1st of March or the 3rd of January depending on who
    // saved the file, and a date is where a guess looks right and is wrong.
    expect(parseLongDate("01/03/1989")).toBeNull();
    expect(parseLongDate("Immediately")).toBeNull();
    expect(parseLongDate("")).toBeNull();
    expect(parseLongDate(null)).toBeNull();
  });
});

describe("formatLongDate", () => {
  it("prints the template's format", () => {
    expect(formatLongDate("1989-02-05")).toBe("05 February 1989");
  });

  it("round trips", () => {
    expect(formatLongDate(parseLongDate("07 September 2026"))).toBe("07 September 2026");
  });

  it("has nothing to say about nothing", () => {
    expect(formatLongDate(null)).toBeNull();
    expect(formatLongDate("not a date")).toBeNull();
  });
});
