import { describe, expect, it } from "vitest";
import { examCodesIn, holdsCertificate } from "@/lib/talent-search/certificates";
import { coerceTalentQuery, describeQuery, parseTalentRequest, refineQuery } from "@/lib/talent-search/query";
import { rankTalent, type PoolCandidate } from "@/lib/talent-search/rank";

describe("exam codes", () => {
  it("reads codes however they are written", () => {
    expect(examCodesIn("mb 500, AZ-900 and PL300")).toEqual(["MB-500", "AZ-900", "PL-300"]);
  });

  it("holds an exam by its code or by its name", () => {
    expect(holdsCertificate(["Azure Fundamentals (AZ-900) - Microsoft (2020)"], "AZ-900").held).toBe(true);
    expect(holdsCertificate(["Microsoft Certified: Dynamics 365 Finance & Operations Apps Developer Associate"], "MB-500")).toEqual({
      held: true,
      via: "Microsoft Certified: Dynamics 365 Finance & Operations Apps Developer Associate",
    });
    expect(holdsCertificate(["PL-300 Microsoft Certified: Power BI Data Analyst Associate"], "pl 300").held).toBe(true);
  });

  it("does not take one exam for another", () => {
    expect(holdsCertificate(["Microsoft Azure AI Fundamentals"], "AZ-900").held).toBe(false);
    expect(holdsCertificate(["Azure Administrator Associate (AZ-104)"], "AZ-900").held).toBe(false);
    expect(holdsCertificate(["MB-300 Core Finance and Operations"], "MB-500").held).toBe(false);
  });

  it("finds a one-word certificate inside a longer entry", () => {
    expect(holdsCertificate(["PMI PMP certified 2019"], "PMP").held).toBe(true);
    expect(holdsCertificate(["Project Management Professional"], "PMP").held).toBe(true);
    expect(holdsCertificate(["PMI-ACP"], "PMP").held).toBe(false);
  });
});

describe("parseTalentRequest", () => {
  it("reads the example from the brief", () => {
    const q = parseTalentRequest("give me 3 software developers with mb 500 certificate");
    expect(q).toMatchObject({ count: 3, role: "Software Developer", certifications: ["MB-500"] });
  });

  it("does not take years or exam numbers as the head count", () => {
    const q = parseTalentRequest("Java developers with 5+ years and AZ-204");
    expect(q.count).toBe(5); // the default, not the 5 of "5+ years"
    expect(q.minYears).toBe(5);
    expect(q.role).toBe("Java Developer");
    expect(q.certifications).toEqual(["AZ-204"]);
  });

  it("reads words for numbers, places and availability", () => {
    const q = parseTalentRequest("find two business analysts in Cape Town available immediately");
    expect(q).toMatchObject({ count: 2, role: "Business Analyst", location: "Cape Town", availableNow: true });
  });

  it("prefers the longer role and reads certificates by name", () => {
    const q = parseTalentRequest("10 senior project managers with PRINCE2");
    expect(q.role).toBe("Senior Project Manager");
    expect(q.count).toBe(10);
    expect(q.certifications).toContain("PRINCE2");
  });

  it("keeps an unknown role as written", () => {
    expect(parseTalentRequest("4 dynamics developers").role).toBe("Dynamics Developer");
  });

  it("caps the count", () => {
    expect(parseTalentRequest("500 testers").count).toBe(25);
  });
});

describe("refineQuery", () => {
  const first = parseTalentRequest("3 software developers with MB-500");

  it("adjusts the last search when no role is named", () => {
    const msg = "make it 5 and only in Gauteng";
    const next = refineQuery(first, msg, parseTalentRequest(msg));
    expect(next).toMatchObject({ count: 5, role: "Software Developer", certifications: ["MB-500"], location: "Gauteng" });
  });

  it("keeps the count when a follow-up names none", () => {
    const msg = "also with AZ-900";
    expect(refineQuery(first, msg, parseTalentRequest(msg))).toMatchObject({ count: 3, certifications: ["MB-500", "AZ-900"] });
  });

  it("starts again for a new role", () => {
    const msg = "2 business analysts";
    expect(refineQuery(first, msg, parseTalentRequest(msg))).toMatchObject({ count: 2, role: "Business Analyst", certifications: [] });
  });
});

describe("coerceTalentQuery", () => {
  it("makes any answer safe", () => {
    const q = coerceTalentQuery({ count: 900, role: "  Data Engineer ", certifications: ["MB-500 certificate", 7], skills: "Python", minYears: -2 });
    expect(q).toMatchObject({ count: 25, role: "Data Engineer", certifications: ["MB-500"], skills: [], minYears: null, availableNow: false });
    expect(coerceTalentQuery(null).count).toBe(5);
  });

  it("says the reading back", () => {
    expect(describeQuery(parseTalentRequest("3 software developers with MB-500 in Pretoria"))).toBe("3 × Software Developer · MB-500 · Pretoria");
  });
});

describe("rankTalent", () => {
  const person = (over: Partial<PoolCandidate>): PoolCandidate => ({
    id: over.full_name ?? "x",
    full_name: "x",
    current_role: "Software Developer",
    additional_roles: [],
    skills: [],
    technical_skills: [],
    certifications: [],
    years_experience: 5,
    availability: "available",
    status: "active",
    location: "Johannesburg",
    ...over,
  });
  const pool = [
    person({ full_name: "Has code", certifications: ["MB-500"] }),
    person({ full_name: "Has name", certifications: ["Microsoft Certified: Dynamics 365 F&O Apps Developer Associate"], years_experience: 9 }),
    person({ full_name: "Document only", certificateDocuments: ["MB-500 certificate"] }),
    person({ full_name: "No cert" }),
    person({ full_name: "Consultant with cert", current_role: "Technical Consultant", certifications: ["MB-500"] }),
    person({ full_name: "Placed", status: "placed", certifications: ["MB-500"] }),
    person({ full_name: "Plumber", current_role: "Plumber" }),
  ];

  it("returns the people who meet everything, with the wording that matched", () => {
    const a = rankTalent(pool, parseTalentRequest("3 software developers with MB-500"));
    expect(a.fits.map((r) => r.name).sort()).toEqual(["Document only", "Has code", "Has name"]);
    expect(a.fits.find((r) => r.name === "Has name")?.certificates[0].via).toContain("F&O Apps Developer");
    expect(a.fitCount).toBe(3);
    expect(a.searched).toBe(6); // placed people are not offered
  });

  it("makes up the number with the nearest misses, certificate holders first, saying what they lack", () => {
    const a = rankTalent(pool, parseTalentRequest("5 software developers with MB-500"));
    expect(a.fits).toHaveLength(3);
    expect(a.close.map((r) => r.name)).toEqual(["Consultant with cert", "No cert"]);
    expect(a.close[0].missing[0]).toMatch(/not a Software Developer/);
    expect(a.close[1].missing).toEqual(["MB-500"]);
  });

  it("never offers someone who matches nothing asked", () => {
    const a = rankTalent(pool, parseTalentRequest("20 software developers with MB-500"));
    expect([...a.fits, ...a.close].map((r) => r.name)).not.toContain("Plumber");
  });

  it("filters by place, counting a city in its province", () => {
    const a = rankTalent(
      [person({ full_name: "Joburg" }), person({ full_name: "Cape", location: "Cape Town" })],
      parseTalentRequest("2 software developers in Gauteng"),
    );
    expect(a.fits.map((r) => r.name)).toEqual(["Joburg"]);
    expect(a.close[0].missing).toEqual(["based in Cape Town"]);
  });

  it("keeps people with no location on file, after those known to be there", () => {
    const a = rankTalent(
      [person({ full_name: "Unknown", location: null, years_experience: 30 }), person({ full_name: "Joburg" })],
      parseTalentRequest("2 software developers in Gauteng"),
    );
    expect(a.fits.map((r) => r.name)).toEqual(["Joburg", "Unknown"]);
    expect(a.fits[1].unchecked).toEqual(["location not on file, check"]);
  });
});

describe("parseTalentRequest, one-word roles", () => {
  it("still reads a bare plural role", () => {
    expect(parseTalentRequest("3 testers").role).toBeTruthy();
    expect(parseTalentRequest("3 testers").count).toBe(3);
  });
});
