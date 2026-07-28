import { describe, it, expect } from "vitest";
import { deriveCategories, CATEGORY_NAMES } from "@/lib/resource-categories";

describe("deriveCategories", () => {
  it("maps D365 / SAP skills to ERP", () => {
    expect(deriveCategories({ technical_skills: ["Microsoft Dynamics 365 F&O", "X++"] })).toContain(
      "ERP",
    );
    expect(deriveCategories({ skills: ["SAP FICO"] })).toContain("ERP");
  });

  it("maps TOGAF / architecture to Enterprise Architecture (EA)", () => {
    expect(deriveCategories({ skills: ["TOGAF"] })).toContain("Enterprise Architecture (EA)");
    expect(deriveCategories({ current_role: "Solution Architect" })).toContain(
      "Enterprise Architecture (EA)",
    );
  });

  it("returns multiple categories for a multi-cluster candidate", () => {
    const cats = deriveCategories({
      technical_skills: ["D365", "Power BI", "Azure"],
    });
    expect(cats).toContain("ERP");
    expect(cats).toContain("Data & BI");
    expect(cats).toContain("Cloud & DevOps");
  });

  it("returns categories in taxonomy order", () => {
    const cats = deriveCategories({ technical_skills: ["Azure"], skills: ["SAP"] });
    // ERP comes before Cloud & DevOps in the taxonomy.
    expect(cats.indexOf("ERP")).toBeLessThan(cats.indexOf("Cloud & DevOps"));
  });

  it("returns an empty array when nothing matches", () => {
    expect(deriveCategories({ skills: ["Gardening"], current_role: "Chef" })).toEqual([]);
    expect(deriveCategories({})).toEqual([]);
  });

  it("every derived category is a known taxonomy name", () => {
    const cats = deriveCategories({ technical_skills: ["React", "SQL"] });
    for (const c of cats) expect(CATEGORY_NAMES).toContain(c);
  });
});
