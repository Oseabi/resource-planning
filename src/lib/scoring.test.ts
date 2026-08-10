import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  overlapRatio,
  roleMatch,
  experienceMatch,
  availabilityMatch,
  SCORING_WEIGHTS,
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

  it("keeps total within 0–100 for a total mismatch", () => {
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
