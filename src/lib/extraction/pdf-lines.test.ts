import { describe, it, expect } from "vitest";
import { groupItemsIntoLines, normaliseLine, type PositionedTextItem } from "@/lib/extraction/pdf-lines";

/** Build a pdf.js-shaped text item at (x, y). */
function item(str: string, x: number, y: number, width = str.length * 5): PositionedTextItem {
  return { str, transform: [1, 0, 0, 1, x, y], width };
}

describe("groupItemsIntoLines", () => {
  it("groups runs sharing a baseline into one line, ordered left to right", () => {
    const lines = groupItemsIntoLines([
      item("World", 60, 700),
      item("Hello", 10, 700, 45),
    ]);
    expect(lines).toEqual(["Hello World"]);
  });

  it("orders lines top to bottom (PDF y grows upwards)", () => {
    const lines = groupItemsIntoLines([
      item("second", 10, 680),
      item("first", 10, 700),
      item("third", 10, 660),
    ]);
    expect(lines).toEqual(["first", "second", "third"]);
  });

  it("treats near-identical baselines as the same line", () => {
    const lines = groupItemsIntoLines([item("A", 10, 700), item("B", 30, 701.4, 5)]);
    expect(lines).toHaveLength(1);
  });

  it("does not insert a space between directly adjacent runs", () => {
    // Two runs of one word split by the font encoding.
    const lines = groupItemsIntoLines([item("Archi", 10, 700, 25), item("tect", 35, 700, 20)]);
    expect(lines).toEqual(["Architect"]);
  });

  it("ignores empty and malformed items", () => {
    const lines = groupItemsIntoLines([
      item("", 10, 700),
      { str: "x", transform: [1, 0, 0, 1] } as unknown as PositionedTextItem,
      item("kept", 10, 700),
    ]);
    expect(lines).toEqual(["kept"]);
  });

  it("keeps headings on their own line so section splitting can work", () => {
    const lines = groupItemsIntoLines([
      item("EXECUTIVE SUMMARY", 10, 700),
      item("Senior delivery executive.", 10, 685),
    ]);
    expect(lines[0]).toBe("EXECUTIVE SUMMARY");
  });
});

describe("normaliseLine", () => {
  it("collapses whitespace and normalises non-breaking hyphens and quotes", () => {
    expect(normaliseLine("high‑risk   delivery")).toBe("high-risk delivery");
    expect(normaliseLine("it’s “quoted”")).toBe(`it's "quoted"`);
  });

  it("preserves en and em dashes used in date ranges", () => {
    expect(normaliseLine("Aug 2021 – Current")).toBe("Aug 2021 – Current");
  });
});
