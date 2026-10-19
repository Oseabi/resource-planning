import { describe, it, expect } from "vitest";
import {
  fold,
  baseKey,
  aliasEqual,
  aliasGroupOf,
  matchQuality,
  validateAliases,
  buildCandidateIndex,
  qualityAgainst,
  NEAR_MATCH_CREDIT,
} from "@/lib/skill-matching";
import { ALIAS_GROUPS, type AliasGroup } from "@/lib/skill-aliases";
import { ALL_ROLES, ALL_TECHNICAL_SKILLS, ALL_CERTIFICATIONS, ALL_SKILLS } from "@/lib/vocabulary";

describe("fold", () => {
  it("ignores case, spacing and the difference between an ampersand and the word", () => {
    expect(fold("  Power   BI ")).toBe("power bi");
    expect(fold("Finance & Operations")).toBe(fold("Finance and Operations"));
    expect(fold("Oracle E-Business Suite")).toBe("oracle e business suite");
  });

  it("keeps the characters that tell languages apart", () => {
    // Stripping punctuation wholesale would collapse all three to "c", which
    // manufactures false positives in the exact list this business bids on.
    expect(fold("C#")).toBe("c#");
    expect(fold("C++")).toBe("c++");
    expect(fold("C")).toBe("c");
    expect(fold("C#")).not.toBe(fold("C++"));
    expect(fold(".NET")).toBe(".net");
    expect(fold("X++")).toBe("x++");
    expect(fold("Node.js")).toBe("node.js");
  });

  it("normalises a typographic dash or quote to its plain form", () => {
    // The dash is the test input: written as an escape so no file in the repo
    // carries a literal one.
    expect(fold("Oracle \u2013 Financials")).toBe(fold("Oracle - Financials"));
  });
});

describe("baseKey", () => {
  it("drops a release number, so a technology and its version compare equal", () => {
    expect(baseKey("Java 8")).toBe("java");
    expect(baseKey("Angular 12")).toBe("angular");
    expect(baseKey(".NET 4.5")).toBe(".net");
    expect(baseKey("ITIL v4")).toBe("itil");
  });

  it("keeps a number that is part of the name, not a version", () => {
    // The guard that makes the whole rule safe. Without it "Dynamics 365"
    // becomes "dynamics" and ISO 27001 collides with ISO 9001.
    expect(baseKey("Dynamics 365")).toBe("dynamics 365");
    expect(baseKey("Office 365")).toBe("office 365");
    expect(baseKey("ISO 27001")).toBe("iso 27001");
    expect(baseKey("ISO 27001")).not.toBe(baseKey("ISO 9001"));
    expect(baseKey("SQL Server 2019")).toBe("sql server 2019");
  });
});

describe("the alias table", () => {
  it("has no form claimed by two groups and no duplicate within a group", () => {
    expect(validateAliases(ALIAS_GROUPS)).toEqual([]);
  });

  it("names only terms the system already knows", () => {
    // The rule inherited from tender-import: an alias must resolve to
    // something the rest of the app can spell, or extraction and matching
    // quietly disagree about the same skill.
    const known = [...ALL_ROLES, ...ALL_TECHNICAL_SKILLS, ...ALL_CERTIFICATIONS, ...ALL_SKILLS];
    expect(validateAliases(ALIAS_GROUPS, known)).toEqual([]);
  });

  it("catches a form claimed by two groups, so the check itself is known to work", () => {
    const broken: AliasGroup[] = [
      { canonical: "SAP", kind: "technology", aliases: ["ERP"] },
      { canonical: "Dynamics 365", kind: "technology", aliases: ["ERP"] },
    ];
    const problems = validateAliases(broken);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ERP");
  });

  it("refuses to relate two things a shared group would make equal", () => {
    // The trap: the ERP practice area in resource-categories.ts lists d365 and
    // sap together, but they are different products, and a table generated
    // from those clusters would make them match.
    expect(aliasEqual("SAP", "Dynamics 365")).toBe(false);
    expect(aliasEqual("Java", "JavaScript")).toBe(false);
  });

  it("never relates one grade of a credential to another", () => {
    expect(aliasEqual("CSCS", "CSCS Gold")).toBe(false);
    expect(aliasEqual("PRINCE2", "PRINCE2 Agile")).toBe(false);
    expect(aliasEqual("SAP ECC", "SAP S/4HANA")).toBe(false);
  });

  it("relates the spellings that actually appear in tenders and CVs", () => {
    expect(aliasEqual("D365 F&O", "Microsoft Dynamics 365 F&O")).toBe(true);
    expect(aliasEqual("Dynamics 365 Finance and Operations", "D365 FO")).toBe(true);
    expect(aliasEqual("PowerBI", "Power BI")).toBe(true);
    expect(aliasEqual("dotnet", ".NET")).toBe(true);
    expect(aliasEqual("GCP", "Google Cloud")).toBe(true);
    expect(aliasEqual("BA", "Business Analyst")).toBe(true);
    expect(aliasEqual("Amazon Web Services", "AWS")).toBe(true);
    expect(aliasEqual("S4HANA", "SAP S/4HANA")).toBe(true);
  });

  it("has no opinion about a term it has never seen", () => {
    expect(aliasGroupOf("Underwater Basket Weaving")).toBeNull();
    expect(aliasEqual("Underwater Basket Weaving", "Basket Weaving")).toBe(false);
  });
});

describe("matchQuality", () => {
  const q = (candidate: string, required: string) => matchQuality(candidate, required);

  it("calls the same words exact, at full credit", () => {
    expect(q("Power BI", "power bi")).toMatchObject({ quality: "exact", credit: 1 });
  });

  it("calls another spelling of the same thing an alias, at full credit", () => {
    // Full credit on purpose: an alias is a statement that the two spellings
    // denote the same thing, and anything less makes the table a half-measure.
    const r = q("D365 F&O", "Microsoft Dynamics 365 F&O");
    expect(r).toMatchObject({ quality: "alias", credit: 1 });
    expect(r.via).toBe("D365 F&O");
  });

  it("treats a release as the same technology, in both directions", () => {
    expect(q("Java 8", "Java")).toMatchObject({ quality: "version", credit: 1 });
    expect(q("Java", "Java 8")).toMatchObject({ quality: "version", credit: 1 });
  });

  it("gives partial credit when the candidate's term is broader than the seat's", () => {
    const r = q("Microsoft Dynamics 365 F&O", "Dynamics 365");
    expect(r.quality).toBe("near");
    expect(r.credit).toBe(NEAR_MATCH_CREDIT);
    expect(r.via).toBe("Microsoft Dynamics 365 F&O");
  });

  it("never lets a narrower term answer a broader requirement", () => {
    expect(q("Azure", "Azure DevOps").quality).toBe("none");
    expect(q("AWS Certified Solutions Architect", "AWS Certified Solutions Architect Professional").quality).toBe("none");
  });

  it("refuses containment when the requirement is a single word", () => {
    // The guard that stops "Azure DevOps" answering a seat that asked for
    // Azure, and the reason Java and JavaScript are never related.
    expect(q("Azure DevOps", "Azure").quality).toBe("none");
    expect(q("JavaScript", "Java").quality).toBe("none");
    expect(q("Java", "JavaScript").quality).toBe("none");
  });

  it("protects a credential grade in both directions", () => {
    expect(q("CSCS", "CSCS Gold").quality).toBe("none");
    expect(q("CSCS Gold", "CSCS").quality).toBe("none");
    expect(q("PRINCE2 Agile", "PRINCE2").quality).toBe("none");
  });

  it("satisfies a longer credential from a longer-still one", () => {
    expect(q("AWS Certified Solutions Architect Professional", "AWS Certified Solutions Architect").quality).toBe("near");
  });

  it("says none when nothing relates them", () => {
    expect(q("Quantity Surveying", "SAP FICO")).toMatchObject({ quality: "none", credit: 0, via: null });
  });
});

describe("buildCandidateIndex and qualityAgainst", () => {
  it("answers from a whole candidate, naming which of their words did it", () => {
    const index = buildCandidateIndex(["React", "D365 Finance and Operations", "Java 8"]);
    expect(qualityAgainst(index, "Microsoft Dynamics 365 F&O")).toMatchObject({
      quality: "alias",
      via: "D365 Finance and Operations",
    });
    expect(qualityAgainst(index, "Java").quality).toBe("version");
    expect(qualityAgainst(index, "Kubernetes").quality).toBe("none");
  });

  it("gives the same answer as the one-shot helper", () => {
    const index = buildCandidateIndex(["PowerBI"]);
    expect(qualityAgainst(index, "Power BI")).toEqual(matchQuality("PowerBI", "Power BI"));
  });

  it("manufactures nothing from an empty candidate", () => {
    // Load-bearing: it is what keeps "a candidate with no skills loses exactly
    // the skills weight" true no matter what the alias table grows into.
    const index = buildCandidateIndex([]);
    expect(qualityAgainst(index, "anything at all")).toMatchObject({ quality: "none", credit: 0 });
  });

  it("does not depend on the order the candidate listed their skills", () => {
    const a = buildCandidateIndex(["Java 8", "React", "PowerBI"]);
    const b = buildCandidateIndex(["PowerBI", "React", "Java 8"]);
    for (const required of ["Java", "Power BI", "React", "Kubernetes"]) {
      expect(qualityAgainst(a, required).quality).toBe(qualityAgainst(b, required).quality);
    }
  });
});
