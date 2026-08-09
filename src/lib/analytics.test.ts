import { describe, it, expect } from "vitest";
import {
  categoryBreakdown,
  experienceBands,
  poolHealth,
  skillGaps,
  tenderPerformance,
  winRateByClient,
  deadlinesAtRisk,
  demandedSkills,
  complianceSummary,
  certificationCoverage,
  categoryReadiness,
  avgTimeToFill,
  recruiterLeaderboard,
  requirementAgeing,
  matchScoreBands,
  type CandidateRow,
  type TenderRow,
} from "@/lib/analytics";

const TODAY = new Date("2026-07-28T00:00:00Z");

function candidate(over: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: crypto.randomUUID(),
    status: "active",
    availability: "available",
    years_experience: 5,
    resource_categories: [],
    skills: [],
    technical_skills: [],
    certifications: [],
    ...over,
  };
}

function tender(over: Partial<TenderRow> = {}): TenderRow {
  return {
    id: crypto.randomUUID(),
    status: "draft",
    client: "Acme",
    value: 100,
    submission_deadline: null,
    sectors: [],
    ...over,
  };
}

describe("categoryBreakdown", () => {
  it("counts a candidate in every category they hold", () => {
    const stats = categoryBreakdown([
      candidate({ resource_categories: ["ERP", "Data & BI"] }),
      candidate({ resource_categories: ["ERP"] }),
    ]);
    const byName = Object.fromEntries(stats.map((s) => [s.name, s.total]));
    expect(byName["ERP"]).toBe(2);
    expect(byName["Data & BI"]).toBe(1);
  });

  it("splits available vs placed and never double-counts them", () => {
    const stats = categoryBreakdown([
      candidate({ resource_categories: ["ERP"], status: "placed" }),
      candidate({ resource_categories: ["ERP"], availability: "available" }),
      candidate({ resource_categories: ["ERP"], availability: "notice_period" }),
    ]);
    const erp = stats[0];
    expect(erp.total).toBe(3);
    expect(erp.placed).toBe(1);
    expect(erp.available).toBe(1); // the notice-period one is neither
  });

  it("surfaces untagged candidates instead of hiding them", () => {
    const stats = categoryBreakdown([candidate()]);
    expect(stats[0].name).toBe("Uncategorised");
  });
});

describe("experienceBands", () => {
  it("buckets by seniority", () => {
    const bands = experienceBands([
      candidate({ years_experience: 1 }),
      candidate({ years_experience: 5 }),
      candidate({ years_experience: 9 }),
      candidate({ years_experience: 20 }),
    ]);
    const byName = Object.fromEntries(bands.map((b) => [b.name, b.count]));
    expect(byName["0–2 yrs"]).toBe(1);
    expect(byName["3–5 yrs"]).toBe(1);
    expect(byName["6–10 yrs"]).toBe(1);
    expect(byName["10+ yrs"]).toBe(1);
  });

  it("adds an Unknown bucket only when needed", () => {
    expect(experienceBands([candidate({ years_experience: 3 })]).some((b) => b.name === "Unknown")).toBe(false);
    expect(experienceBands([candidate({ years_experience: null })]).some((b) => b.name === "Unknown")).toBe(true);
  });
});

describe("poolHealth", () => {
  it("measures availability against the non-placed pool", () => {
    const health = poolHealth([
      candidate({ availability: "available" }),
      candidate({ availability: "notice_period" }),
      candidate({ status: "placed", availability: "available" }),
    ]);
    expect(health.total).toBe(3);
    expect(health.placed).toBe(1);
    expect(health.available).toBe(1);
    expect(health.availablePct).toBe(50); // 1 of the 2 unplaced
  });

  it("does not divide by zero on an empty pool", () => {
    expect(poolHealth([]).availablePct).toBe(0);
  });
});

describe("skillGaps", () => {
  const pool = [
    candidate({ technical_skills: ["SAP"] }),
    candidate({ skills: ["TOGAF"] }),
    candidate({ status: "placed", technical_skills: ["Azure"] }), // not active
  ];

  it("ranks the thinnest coverage first", () => {
    const gaps = skillGaps(["SAP", "Azure"], pool);
    expect(gaps[0]).toEqual({ skill: "Azure", covered: 0 });
  });

  it("matches case-insensitively across both skill lists", () => {
    expect(skillGaps(["togaf"], pool)[0].covered).toBe(1);
  });

  it("ignores duplicate demand entries", () => {
    expect(skillGaps(["SAP", "sap"], pool)).toHaveLength(1);
  });
});

describe("tenderPerformance", () => {
  const tenders = [
    tender({ status: "won", value: 1000 }),
    tender({ status: "won", value: 500 }),
    tender({ status: "lost", value: 800 }),
    tender({ status: "live", value: 200 }),
    tender({ status: "submitted", value: 300 }),
  ];

  it("computes win rate from decided bids only", () => {
    expect(tenderPerformance(tenders).winRate).toBe(67); // 2 of 3
  });

  it("separates won, lost and pipeline value", () => {
    const p = tenderPerformance(tenders);
    expect(p.wonValue).toBe(1500);
    expect(p.lostValue).toBe(800);
    expect(p.pipelineValue).toBe(500); // live + submitted
    expect(p.avgDealSize).toBe(750);
  });

  it("returns null rather than 0% when nothing is decided", () => {
    const p = tenderPerformance([tender({ status: "live" })]);
    expect(p.winRate).toBeNull();
    expect(p.avgDealSize).toBeNull();
  });
});

describe("winRateByClient", () => {
  it("tracks each client's record and won value", () => {
    const rows = winRateByClient([
      tender({ client: "Eskom", status: "won", value: 100 }),
      tender({ client: "Eskom", status: "lost", value: 900 }),
      tender({ client: "TCTA", status: "won", value: 50 }),
    ]);
    const eskom = rows.find((r) => r.client === "Eskom")!;
    expect(eskom.bids).toBe(2);
    expect(eskom.winRate).toBe(50);
    expect(eskom.value).toBe(100); // only won value counts
    expect(rows.find((r) => r.client === "TCTA")!.winRate).toBe(100);
  });

  it("leaves win rate null for clients with no decided bids", () => {
    expect(winRateByClient([tender({ client: "New", status: "live" })])[0].winRate).toBeNull();
  });
});

describe("deadlinesAtRisk", () => {
  it("returns only open bids inside the window, soonest first", () => {
    const rows = deadlinesAtRisk(
      [
        tender({ status: "live", submission_deadline: "2026-08-10" }), // 13 days
        tender({ status: "draft", submission_deadline: "2026-07-30" }), // 2 days
        tender({ status: "live", submission_deadline: "2026-12-01" }), // outside
        tender({ status: "won", submission_deadline: "2026-07-29" }), // already decided
      ],
      30,
      TODAY,
    );
    expect(rows.map((r) => r.daysLeft)).toEqual([2, 13]);
  });

  it("includes overdue bids with a negative countdown", () => {
    const rows = deadlinesAtRisk(
      [tender({ status: "live", submission_deadline: "2026-07-20" })],
      30,
      TODAY,
    );
    expect(rows[0].daysLeft).toBe(-8);
  });
});

describe("demandedSkills", () => {
  const requirements = [
    { id: "r-open", status: "open" },
    { id: "r-closed", status: "closed" },
  ];
  const tenders = [
    { id: "t-live", status: "live" },
    { id: "t-won", status: "won" },
  ];
  const positions = [
    { parent_type: "job_requirement", parent_id: "r-open", required_skills: ["SAP"] },
    { parent_type: "job_requirement", parent_id: "r-closed", required_skills: ["Ignored"] },
    { parent_type: "tender", parent_id: "t-live", required_skills: ["TOGAF", "SAP"] },
    { parent_type: "tender", parent_id: "t-won", required_skills: ["AlsoIgnored"] },
  ];

  it("unions position skills across open requirements and in-flight tenders", () => {
    expect(demandedSkills(requirements, tenders, positions).sort()).toEqual(["SAP", "TOGAF"]);
  });

  it("ignores positions whose parent is closed or already decided", () => {
    const skills = demandedSkills(requirements, tenders, positions);
    expect(skills).not.toContain("Ignored");
    expect(skills).not.toContain("AlsoIgnored");
  });

  it("does not credit demand to a position with no live parent", () => {
    const orphan = [
      { parent_type: "tender", parent_id: "missing", required_skills: ["Ghost"] },
    ];
    expect(demandedSkills(requirements, tenders, orphan)).toEqual([]);
  });
});

describe("complianceSummary", () => {
  const letters = [
    { oem_vendor: "Microsoft", categories: ["ERP"], expiry_date: "2027-01-01" }, // valid
    { oem_vendor: "Microsoft", categories: [], expiry_date: "2026-08-15" }, // expiring
    { oem_vendor: "SAP", categories: [], expiry_date: "2026-01-01" }, // expired
    { oem_vendor: "SAP", categories: [], expiry_date: null }, // unknown
  ];

  it("buckets letters by validity and counts distinct vendors", () => {
    const s = complianceSummary(letters, TODAY);
    expect(s).toMatchObject({
      total: 4,
      valid: 1,
      expiringSoon: 1,
      expired: 1,
      noExpiry: 1,
      vendors: 2,
    });
  });

  it("treats everything but expired as bid-ready", () => {
    expect(complianceSummary(letters, TODAY).readyPct).toBe(75);
  });

  it("handles an empty vault without dividing by zero", () => {
    expect(complianceSummary([], TODAY).readyPct).toBe(0);
  });
});

describe("certificationCoverage", () => {
  it("counts certifications across active candidates only", () => {
    const rows = certificationCoverage([
      candidate({ certifications: ["PRINCE2", "TOGAF"] }),
      candidate({ certifications: ["PRINCE2"] }),
      candidate({ status: "inactive", certifications: ["PRINCE2"] }),
    ]);
    expect(rows[0]).toEqual({ name: "PRINCE2", count: 2 });
  });

  it("does not double-count a duplicate within one candidate", () => {
    const rows = certificationCoverage([candidate({ certifications: ["PMP", "PMP"] })]);
    expect(rows[0].count).toBe(1);
  });
});

describe("categoryReadiness", () => {
  it("pairs people against OEM letters per practice area", () => {
    const rows = categoryReadiness(
      [candidate({ resource_categories: ["EA"] }), candidate({ resource_categories: ["ERP"] })],
      [{ oem_vendor: "SAP", categories: ["ERP"], expiry_date: null }],
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["EA"]).toMatchObject({ people: 1, letters: 0 }); // capability, no paperwork
    expect(byName["ERP"]).toMatchObject({ people: 1, letters: 1 });
  });

  it("includes areas that have letters but nobody skilled", () => {
    const rows = categoryReadiness([], [
      { oem_vendor: "Cisco", categories: ["Cybersecurity"], expiry_date: null },
    ]);
    expect(rows[0]).toMatchObject({ name: "Cybersecurity", people: 0, letters: 1 });
  });
});

describe("avgTimeToFill", () => {
  it("averages days from requirement creation to placement", () => {
    const days = avgTimeToFill(
      [
        { source_type: "job_requirement", source_id: "r1", fee_value: 0, created_at: "2026-01-11T00:00:00Z", created_by: "u" },
        { source_type: "job_requirement", source_id: "r2", fee_value: 0, created_at: "2026-01-21T00:00:00Z", created_by: "u" },
      ],
      [
        { id: "r1", created_at: "2026-01-01T00:00:00Z" },
        { id: "r2", created_at: "2026-01-01T00:00:00Z" },
      ],
    );
    expect(days).toBe(15); // (10 + 20) / 2
  });

  it("ignores tender placements and unknown requirements", () => {
    expect(
      avgTimeToFill(
        [{ source_type: "tender", source_id: "t1", fee_value: 0, created_at: "2026-01-11T00:00:00Z", created_by: "u" }],
        [{ id: "r1", created_at: "2026-01-01T00:00:00Z" }],
      ),
    ).toBeNull();
  });
});

describe("recruiterLeaderboard", () => {
  it("ranks by placements then revenue, grouping unattributed work", () => {
    const rows = recruiterLeaderboard([
      { source_type: "job_requirement", source_id: "a", fee_value: 100, created_at: "", created_by: "u1" },
      { source_type: "job_requirement", source_id: "b", fee_value: 200, created_at: "", created_by: "u1" },
      { source_type: "job_requirement", source_id: "c", fee_value: 900, created_at: "", created_by: null },
    ]);
    expect(rows[0]).toEqual({ recruiterId: "u1", placements: 2, revenue: 300 });
    expect(rows[1].recruiterId).toBe("unattributed");
  });
});

describe("requirementAgeing", () => {
  it("buckets only open requirements by age", () => {
    const rows = requirementAgeing(
      [
        { id: "1", status: "open", created_at: "2026-07-25T00:00:00Z", required_skills: [] }, // 3 days
        { id: "2", status: "open", created_at: "2026-07-01T00:00:00Z", required_skills: [] }, // 27 days
        { id: "3", status: "open", created_at: "2026-01-01T00:00:00Z", required_skills: [] }, // 200+
        { id: "4", status: "closed", created_at: "2026-01-01T00:00:00Z", required_skills: [] },
      ],
      TODAY,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.count]));
    expect(byName["< 2 weeks"]).toBe(1);
    expect(byName["2–4 weeks"]).toBe(1);
    expect(byName["3 months+"]).toBe(1);
    expect(byName["1–3 months"]).toBe(0);
  });
});

describe("matchScoreBands", () => {
  it("splits scores at the alert and strong-match thresholds", () => {
    const rows = matchScoreBands([95, 80, 79, 70, 69, 50, 49, 10]);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.count]));
    expect(byName["80–100%"]).toBe(2);
    expect(byName["70–79%"]).toBe(2);
    expect(byName["50–69%"]).toBe(2);
    expect(byName["< 50%"]).toBe(2);
  });
});
