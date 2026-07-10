import { describe, it, expect } from "vitest";
import {
  candidateToScoringInput,
  requirementToScoringInput,
  toScoreBreakdownJson,
  scoreCandidateForRequirement,
  scoreCandidateForTender,
  poolStrength,
  poolGapAnalysis,
  decideAlert,
} from "@/lib/matching";

const candidate = {
  current_role: "ERP Consultant",
  additional_roles: ["Full Stack Developer"],
  skills: ["Stakeholder Management"],
  technical_skills: ["React", "Microsoft Dynamics 365 F&O"],
  certifications: ["AWS Certified Developer"],
  years_experience: 7,
  availability: "notice_period" as const,
};

describe("candidateToScoringInput", () => {
  it("carries additional roles and technical skills", () => {
    const input = candidateToScoringInput(candidate);
    expect(input.additional_roles).toContain("Full Stack Developer");
    expect(input.technical_skills).toContain("React");
  });
});

describe("requirementToScoringInput", () => {
  it("normalises an unknown required_availability to null", () => {
    const req = requirementToScoringInput({
      required_role: "ERP Consultant",
      required_skills: ["React"],
      required_certifications: [],
      min_experience_years: 5,
      required_availability: "whenever",
    });
    expect(req.required_availability).toBeNull();
  });
});

describe("scoreCandidateForRequirement", () => {
  it("scores a strong fit highly and exposes a breakdown", () => {
    const result = scoreCandidateForRequirement(candidate, {
      required_role: "ERP Consultant",
      required_skills: ["React", "Stakeholder Management"],
      required_certifications: ["AWS Certified Developer"],
      min_experience_years: 5,
      required_availability: null,
    });
    expect(result.total).toBeGreaterThanOrEqual(90);
    const json = toScoreBreakdownJson(result);
    expect(json.total).toBe(result.total);
    expect(json.points.role).toBeGreaterThan(0);
    expect(Object.keys(json.breakdown)).toEqual([
      "role",
      "skills",
      "certifications",
      "experience",
      "availability",
    ]);
  });

  it("uses the additional role when it beats the primary", () => {
    const result = scoreCandidateForRequirement(candidate, {
      required_role: "Full Stack Developer",
      required_skills: [],
      required_certifications: [],
      min_experience_years: null,
      required_availability: null,
    });
    expect(result.breakdown.role).toBe(1);
  });
});

describe("scoreCandidateForTender", () => {
  it("scores against the best of the tender's required roles", () => {
    const result = scoreCandidateForTender(candidate, {
      required_roles: ["Site Manager", "Full Stack Developer"],
      required_skills: [],
      required_certifications: [],
    });
    // "Full Stack Developer" is one of the candidate's roles → full role marks.
    expect(result.breakdown.role).toBe(1);
  });

  it("handles a tender with no required roles", () => {
    const result = scoreCandidateForTender(candidate, {
      required_roles: [],
      required_skills: ["React"],
      required_certifications: [],
    });
    expect(result.breakdown.role).toBe(1); // no requirement => full marks
    expect(result.breakdown.skills).toBe(1);
  });
});

describe("poolStrength", () => {
  it("averages the top three scores", () => {
    expect(poolStrength([95, 71, 20, 15])).toBe(Math.round((95 + 71 + 20) / 3));
  });
  it("is 0 for an empty pool", () => {
    expect(poolStrength([])).toBe(0);
  });
});

describe("poolGapAnalysis", () => {
  it("reports per-role strong-match coverage", () => {
    const gaps = poolGapAnalysis([candidate], {
      required_roles: ["ERP Consultant", "Site Manager"],
      required_skills: [],
      required_certifications: [],
    });
    const byRole = Object.fromEntries(gaps.map((g) => [g.role, g.covered]));
    expect(byRole["ERP Consultant"]).toBe(1); // exact role match → ≥70
    expect(byRole["Site Manager"]).toBe(0); // no fit
  });
});

describe("decideAlert", () => {
  it("does not alert below the 80 threshold", () => {
    expect(decideAlert(null, 79)).toBe(false);
  });
  it("alerts the first time at or above threshold", () => {
    expect(decideAlert(null, 80)).toBe(true);
    expect(decideAlert(null, 92)).toBe(true);
  });
  it("does not re-alert for a small rise", () => {
    expect(decideAlert(85, 88)).toBe(false);
  });
  it("re-alerts on a material rise", () => {
    expect(decideAlert(85, 90)).toBe(true);
  });
  it("does not alert if the score dropped below threshold", () => {
    expect(decideAlert(85, 70)).toBe(false);
  });
});
