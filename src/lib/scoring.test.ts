import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  overlapRatio,
  overlapDetail,
  roleMatch,
  experienceMatch,
  availabilityMatch,
  SCORING_WEIGHTS,
  NEAR_MATCH_CREDIT,
  type CandidateInput,
  type RequirementInput,
} from "@/lib/scoring";

describe("overlapRatio", () => {
  it("returns full marks when nothing is required", () => {
    expect(overlapRatio([], [])).toBe(1);
    expect(overlapRatio(["AutoCAD"], [])).toBe(1);
  });

  it("computes fraction of required items present", () => {
    expect(overlapRatio(["AutoCAD", "Revit"], ["AutoCAD", "Revit"])).toBe(1);
    expect(overlapRatio(["AutoCAD"], ["AutoCAD", "Revit"])).toBe(0.5);
    expect(overlapRatio([], ["AutoCAD"])).toBe(0);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(overlapRatio(["  autocad "], ["AutoCAD"])).toBe(1);
  });
});

describe("overlapDetail", () => {
  it("splits required items into matched and missing", () => {
    const result = overlapDetail(["AutoCAD", "Excel"], ["AutoCAD", "Revit", "BIM"]);
    expect(result.matched).toEqual(["AutoCAD"]);
    expect(result.missing).toEqual(["Revit", "BIM"]);
    expect(result.ratio).toBeCloseTo(1 / 3);
  });

  it("reports the requirement's spelling, not the candidate's", () => {
    // What the client asked for is what gets shown back to the user.
    const result = overlapDetail(["  autocad "], ["AutoCAD"]);
    expect(result.matched).toEqual(["AutoCAD"]);
    expect(result.missing).toEqual([]);
  });

  it("returns full marks and two empty lists when nothing is required", () => {
    const result = overlapDetail(["AutoCAD"], []);
    expect(result.ratio).toBe(1);
    expect(result.matched).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("counts everything missing when the candidate has nothing", () => {
    const result = overlapDetail([], ["AutoCAD", "Revit"]);
    expect(result.matched).toEqual([]);
    expect(result.missing).toEqual(["AutoCAD", "Revit"]);
    expect(result.ratio).toBe(0);
  });

  it("agrees with overlapRatio, which is now built on it", () => {
    const candidate = ["AutoCAD", "Excel"];
    const required = ["AutoCAD", "Revit", "BIM"];
    expect(overlapDetail(candidate, required).ratio).toBe(overlapRatio(candidate, required));
  });
});

describe("roleMatch", () => {
  it("gives full marks with no required role", () => {
    expect(roleMatch("Civil Engineer", null)).toBe(1);
  });

  it("scores exact (normalized) match as 1", () => {
    expect(roleMatch("Structural Engineer", "structural engineer")).toBe(1);
  });

  it("scores zero when candidate has no role but one is required", () => {
    expect(roleMatch(null, "Civil Engineer")).toBe(0);
  });

  it("gives partial (capped) credit for token overlap", () => {
    const score = roleMatch("Senior Structural Engineer", "Structural Engineer");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(0.9);
  });
});

describe("experienceMatch", () => {
  it("gives full marks when no minimum set", () => {
    expect(experienceMatch(3, null)).toBe(1);
    expect(experienceMatch(null, 0)).toBe(1);
  });

  it("gives full marks at or above the minimum", () => {
    expect(experienceMatch(10, 10)).toBe(1);
    expect(experienceMatch(12, 10)).toBe(1);
  });

  it("tapers linearly below the minimum", () => {
    expect(experienceMatch(5, 10)).toBe(0.5);
    expect(experienceMatch(0, 10)).toBe(0);
    expect(experienceMatch(null, 10)).toBe(0);
  });
});

describe("availabilityMatch", () => {
  it("rewards readiness when no requirement is set", () => {
    expect(availabilityMatch("available", null)).toBe(1);
    expect(availabilityMatch("notice_period", null)).toBe(0.5);
    expect(availabilityMatch("unavailable", null)).toBe(0);
  });

  it("gives full marks when meeting or beating the requirement", () => {
    expect(availabilityMatch("available", "notice_period")).toBe(1);
    expect(availabilityMatch("notice_period", "notice_period")).toBe(1);
  });

  it("tapers when worse than required", () => {
    expect(availabilityMatch("notice_period", "available")).toBe(0.5);
    expect(availabilityMatch("unavailable", "available")).toBe(0);
  });
});

describe("scoreCandidate", () => {
  const perfectCandidate: CandidateInput = {
    current_role: "Structural Engineer",
    skills: ["AutoCAD", "Revit", "Tekla Structures"],
    certifications: ["CSCS Gold", "SMSTS"],
    years_experience: 12,
    availability: "available",
  };

  const requirement: RequirementInput = {
    required_role: "Structural Engineer",
    required_skills: ["AutoCAD", "Revit", "Tekla Structures"],
    required_certifications: ["CSCS Gold", "SMSTS"],
    min_experience_years: 10,
    required_availability: "notice_period",
  };

  it("scores a perfect candidate as 100", () => {
    const result = scoreCandidate(perfectCandidate, requirement);
    expect(result.total).toBe(100);
    expect(result.breakdown.role).toBe(1);
    expect(result.breakdown.skills).toBe(1);
  });

  it("weights each criterion correctly", () => {
    // Candidate matches everything except skills (has 0 of 2 required).
    const candidate: CandidateInput = {
      ...perfectCandidate,
      skills: [],
    };
    const req: RequirementInput = {
      ...requirement,
      required_skills: ["AutoCAD", "Revit"],
    };
    const result = scoreCandidate(candidate, req);
    // Loses the full 25 skills points, keeps the other 75.
    expect(result.total).toBe(100 - SCORING_WEIGHTS.skills);
    expect(result.points.skills).toBe(0);
  });

  it("returns points summing to the total", () => {
    const result = scoreCandidate(perfectCandidate, requirement);
    const sum =
      result.points.role +
      result.points.skills +
      result.points.certifications +
      result.points.experience +
      result.points.availability;
    expect(Math.round(sum)).toBe(result.total);
  });

  it("uses the best-matching role across primary + additional roles", () => {
    const candidate: CandidateInput = {
      current_role: "ERP Consultant",
      additional_roles: ["Project Manager"],
      skills: [],
      certifications: [],
      years_experience: 5,
      availability: "available",
    };
    const req: RequirementInput = {
      required_role: "Project Manager",
      required_skills: [],
      required_certifications: [],
      min_experience_years: null,
      required_availability: null,
    };
    // The additional role is an exact match, so role should score full.
    expect(scoreCandidate(candidate, req).breakdown.role).toBe(1);
  });

  it("combines technical + professional skills for overlap", () => {
    const candidate: CandidateInput = {
      current_role: "Developer",
      skills: ["Stakeholder Management"],
      technical_skills: ["React", "Node.js"],
      certifications: [],
      years_experience: 5,
      availability: "available",
    };
    const req: RequirementInput = {
      required_role: null,
      required_skills: ["React", "Stakeholder Management"],
      required_certifications: [],
      min_experience_years: null,
      required_availability: null,
    };
    // React (technical) + Stakeholder Management (professional) both count.
    expect(scoreCandidate(candidate, req).breakdown.skills).toBe(1);
  });

  it("scores an empty requirement as 100 (nothing to fail)", () => {
    const emptyReq: RequirementInput = {
      required_role: null,
      required_skills: [],
      required_certifications: [],
      min_experience_years: null,
      required_availability: null,
    };
    const result = scoreCandidate(perfectCandidate, emptyReq);
    expect(result.total).toBe(100);
  });

  it("keeps total within 0 to 100 for a total mismatch", () => {
    const weak: CandidateInput = {
      current_role: null,
      skills: [],
      certifications: [],
      years_experience: 0,
      availability: "unavailable",
    };
    const result = scoreCandidate(weak, requirement);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
  });
});

describe("overlapDetail across the ways a skill gets written", () => {
  it("credits another spelling of the same thing in full", () => {
    // The bug this whole layer exists to fix: a person whose CV says
    // "D365 F&O" scored zero against a seat asking for the long form, and
    // skills are 25 of the 100 points.
    const d = overlapDetail(["D365 F&O"], ["Microsoft Dynamics 365 F&O"]);
    expect(d.ratio).toBe(1);
    expect(d.matched).toEqual(["Microsoft Dynamics 365 F&O"]);
    expect(d.near).toEqual([]);
    expect(d.items[0].quality).toBe("alias");
    // Shown back in the requirement's spelling, with the candidate's own
    // words as the reason. A near match nobody can see the reason for is
    // indistinguishable from a bug.
    expect(d.items[0].via).toBe("D365 F&O");
  });

  it("credits a release of the same technology in full, either way round", () => {
    expect(overlapDetail(["Java 8"], ["Java"]).ratio).toBe(1);
    expect(overlapDetail(["Java"], ["Java 8"]).ratio).toBe(1);
  });

  it("gives a broader term partial credit, not full", () => {
    const d = overlapDetail(["Microsoft Dynamics 365 F&O"], ["Dynamics 365"]);
    expect(d.ratio).toBe(NEAR_MATCH_CREDIT);
    expect(d.matched).toEqual([]);
    expect(d.near).toEqual(["Dynamics 365"]);
    expect(d.items[0].via).toBe("Microsoft Dynamics 365 F&O");
  });

  it("adds up a mix of exact and approximate", () => {
    const d = overlapDetail(
      ["AutoCAD", "Revit", "Microsoft Dynamics 365 F&O"],
      ["AutoCAD", "Revit", "Dynamics 365"],
    );
    expect(d.ratio).toBeCloseTo((2 + NEAR_MATCH_CREDIT) / 3, 10);
  });

  it("puts every required item in exactly one bucket, in order", () => {
    const d = overlapDetail(["AutoCAD", "Microsoft Dynamics 365 F&O"], ["AutoCAD", "Dynamics 365", "SAP FICO"]);
    expect(d.matched.length + d.near.length + d.missing.length).toBe(3);
    expect(d.items.map((i) => i.required)).toEqual(["AutoCAD", "Dynamics 365", "SAP FICO"]);
  });

  it("still scores nothing for a candidate with nothing", () => {
    // No layer can manufacture credit out of an empty list, which is what
    // keeps "a dropped criterion costs exactly its weight" structurally true.
    const d = overlapDetail([], ["AutoCAD"]);
    expect(d.ratio).toBe(0);
    expect(d.items.every((i) => i.quality === "none")).toBe(true);
  });

  it("never lets one grade of a credential answer for another", () => {
    expect(overlapDetail(["CSCS"], ["CSCS Gold"]).ratio).toBe(0);
    expect(overlapDetail(["PRINCE2"], ["PRINCE2 Agile"]).ratio).toBe(0);
  });

  it("never lets Java answer a requirement for JavaScript", () => {
    // The headline false positive this layer has to avoid. Both directions.
    expect(overlapDetail(["Java"], ["JavaScript"]).ratio).toBe(0);
    expect(overlapDetail(["JavaScript"], ["Java"]).ratio).toBe(0);
  });
});

describe("roleMatch across the ways a seat gets written", () => {
  it("scores an abbreviated seat against the written-out role", () => {
    // Tenders abbreviate the seat and CVs write it out; until now that cost
    // the candidate all 35 role points.
    expect(roleMatch("Business Analyst", "BA")).toBe(1);
    expect(roleMatch("BA", "Business Analyst")).toBe(1);
    expect(roleMatch("Solution Architect", "Solutions Architect")).toBe(1);
  });

  it("never returns more than full marks", () => {
    for (const [c, r] of [["BA", "Business Analyst"], ["Java", "JavaScript"], ["PM", "Project Manager"]]) {
      expect(roleMatch(c, r)).toBeLessThanOrEqual(1);
    }
  });
});

describe("what a 100 means", () => {
  const candidate: CandidateInput = {
    current_role: "Structural Engineer",
    skills: ["AutoCAD", "Revit"],
    certifications: ["CSCS Gold"],
    years_experience: 12,
    availability: "available",
  };
  const requirement: RequirementInput = {
    required_role: "Structural Engineer",
    required_skills: ["AutoCAD", "Revit"],
    required_certifications: ["CSCS Gold"],
    min_experience_years: 10,
    required_availability: "available",
  };

  it("a candidate holding everything asked for still scores exactly 100", () => {
    expect(scoreCandidate(candidate, requirement).total).toBe(100);
  });

  it("an approximate answer cannot reach 100", () => {
    // What makes the breakdown panel trustworthy: a 100 means the person
    // literally holds everything the seat asked for.
    const approximate = scoreCandidate(
      { ...candidate, skills: ["AutoCAD", "Microsoft Dynamics 365 F&O"] },
      { ...requirement, required_skills: ["AutoCAD", "Dynamics 365"] },
    );
    expect(approximate.total).toBeLessThan(100);
    expect(approximate.total).toBeGreaterThan(90);
  });

  it("an empty requirement still scores 100, alias-rich candidate or not", () => {
    const empty: RequirementInput = {
      required_role: null,
      required_skills: [],
      required_certifications: [],
      min_experience_years: null,
    };
    expect(scoreCandidate({ ...candidate, skills: ["D365 F&O", "PowerBI"] }, empty).total).toBe(100);
  });
});

describe("a candidate row with a null in one of its arrays", () => {
  // A single such row used to throw out of overlapDetail and take the whole
  // run with it, for every seat and every other candidate.
  const candidate = {
    current_role: "Business Analyst",
    additional_roles: [null as unknown as string],
    skills: ["Power BI", null as unknown as string],
    technical_skills: [null as unknown as string],
    certifications: [null as unknown as string, "PMP"],
    years_experience: 8,
    availability: "available" as const,
  };

  it("scores rather than throwing, and still credits the real entries", () => {
    const r = scoreCandidate(candidate, {
      required_role: "Business Analyst",
      required_skills: ["PowerBI"],
      required_certifications: ["PMP"],
      min_experience_years: 5,
    });
    expect(r.total).toBe(100);
  });

  it("survives a null on the requirement side too", () => {
    expect(() =>
      scoreCandidate(candidate, {
        required_role: null,
        required_skills: [null as unknown as string],
        required_certifications: [],
        min_experience_years: null,
      }),
    ).not.toThrow();
  });
});
