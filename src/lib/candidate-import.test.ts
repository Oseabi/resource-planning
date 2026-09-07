import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv";
import { buildRoleIndex } from "@/lib/tender-import";
import {
  parseYears,
  parseAvailability,
  parseCandidateStatus,
  parseDesignatedGroup,
  phoneKey,
  readCandidateRows,
  buildCandidatePlan,
  CANDIDATE_COLUMNS,
  type ExistingCandidate,
} from "@/lib/candidate-import";

const ROLES = ["Business Analyst", "Project Manager", "ERP Consultant", "Systems Analyst"];
const index = buildRoleIndex(ROLES, []);

const HEADERS = CANDIDATE_COLUMNS.join(",");

/** One roster row, given as a partial map of column to cell. */
function csv(...rows: Record<string, string>[]): string {
  const lines = [HEADERS];
  for (const row of rows) {
    lines.push(
      CANDIDATE_COLUMNS.map((c) => {
        const v = row[c] ?? "";
        return v.includes(",") ? `"${v}"` : v;
      }).join(","),
    );
  }
  return lines.join("\n");
}

const read = (text: string) => readCandidateRows(parseCsv(text), index);

function stored(
  overrides: Partial<ExistingCandidate> & { columns?: Record<string, unknown> } = {},
): ExistingCandidate {
  const { columns, ...rest } = overrides;
  return {
    id: "c1",
    full_name: "Thandiwe Mokoena",
    email: "t.mokoena@tippfocus.co.za",
    phone: null,
    hasCv: false,
    columns: {
      full_name: "Thandiwe Mokoena",
      email: "t.mokoena@tippfocus.co.za",
      phone: null,
      location: null,
      current_role: null,
      additional_roles: [],
      years_experience: null,
      designated_group: null,
      qualifications: [],
      certifications: [],
      technical_skills: [],
      skills: [],
      sectors: [],
      languages: [],
      availability: "available",
      available_from: null,
      status: "active",
      resource_categories: [],
      notes: null,
      ...(columns ?? {}),
    },
    ...rest,
  };
}

describe("parseYears", () => {
  it("accepts none, because a graduate has none", () => {
    expect(parseYears("0")).toEqual({ years: 0, error: null });
  });

  it("accepts part years", () => {
    expect(parseYears("7.5").years).toBe(7.5);
  });

  it("reads a blank cell as unknown rather than zero", () => {
    expect(parseYears("")).toEqual({ years: null, error: null });
  });

  it("rejects a range, which a person means but a number cannot hold", () => {
    expect(parseYears("5-7").error).toMatch(/not a number of years/);
  });

  it("rejects a figure longer than a career", () => {
    // Usually a year typed into the wrong column.
    expect(parseYears("2019").error).toMatch(/longer than a career/);
  });
});

describe("parseAvailability", () => {
  it("reads the three the system stores", () => {
    expect(parseAvailability("available").availability).toBe("available");
    expect(parseAvailability("unavailable").availability).toBe("unavailable");
  });

  it("reads the spellings a person actually types", () => {
    expect(parseAvailability("Notice Period").availability).toBe("notice_period");
    expect(parseAvailability("notice-period").availability).toBe("notice_period");
  });

  it("rejects anything else rather than guessing", () => {
    expect(parseAvailability("maybe").error).toMatch(/is not one of/);
  });

  it("leaves a blank cell to the column default", () => {
    expect(parseAvailability("")).toEqual({ availability: null, error: null });
  });
});

describe("parseCandidateStatus", () => {
  it("accepts the two a person owns", () => {
    expect(parseCandidateStatus("Active").status).toBe("active");
    expect(parseCandidateStatus("inactive").status).toBe("inactive");
  });

  it("refuses placed, which only a placement can make true", () => {
    // Typing it produces a candidate the system reports as placed with nothing
    // to show for it, which is a row orphan_check.sql exists to catch.
    const result = parseCandidateStatus("placed");
    expect(result.status).toBeNull();
    expect(result.error).toMatch(/assigned to a contract/);
  });
});

describe("parseDesignatedGroup", () => {
  it("corrects case, since a ninth spelling is unfilterable", () => {
    const result = parseDesignatedGroup("african female");
    expect(result.group).toBe("African Female");
    expect(result.note).toMatch(/read as/);
  });

  it("says nothing when it is already right", () => {
    expect(parseDesignatedGroup("Indian Male")).toEqual({
      group: "Indian Male",
      note: null,
      warning: null,
    });
  });

  it("keeps an unrecognised value but warns it will not be counted", () => {
    // The app's own field allows free text, so rejecting here would be stricter
    // than the form it feeds.
    const result = parseDesignatedGroup("Black Female");
    expect(result.group).toBe("Black Female");
    expect(result.warning).toMatch(/not be counted/);
  });
});

describe("phoneKey", () => {
  it("reads a national and an international number as one person", () => {
    expect(phoneKey("082 555 0143")).toBe(phoneKey("+27 82 555 0143"));
  });

  it("ignores punctuation", () => {
    expect(phoneKey("(082) 555-0143")).toBe("825550143");
  });

  it("has nothing to say about a blank", () => {
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey("")).toBeNull();
  });
});

describe("readCandidateRows", () => {
  it("rejects the whole file on an unrecognised column", () => {
    // A typo that silently drops availability for eighty people is found six
    // months later by somebody staffing a bid.
    const { problems } = read("full_name,availabilty\nThandiwe,available");
    expect(problems[0].reasons.join(" ")).toMatch(/unrecognised column.*availabilty/);
  });

  it("rejects a file with no name column", () => {
    const { problems } = read("email,phone\na@b.co.za,082");
    expect(problems[0].reasons.join(" ")).toMatch(/missing column.*full_name/);
  });

  it("corrects a known abbreviation and says so", () => {
    const { parsed } = read(csv({ full_name: "Sipho Dlamini", current_role: "Snr BA" }));
    expect(parsed[0].current_role).toBe("Business Analyst");
    expect(parsed[0].roleNotes[0]).toMatch(/"Snr BA" read as "Business Analyst"/);
  });

  it("rejects a role spelling nothing recognises, with the nearest known ones", () => {
    // This is the check that pays for the importer: an unrecognised role scores
    // zero of role's 35 points, capping the person at 65 against a threshold of
    // 70, so they can never be a strong match for their own discipline.
    const { parsed, problems, unknownRoles } = read(
      csv({ full_name: "Sipho Dlamini", current_role: "Lead Business Person" }),
    );
    expect(parsed).toHaveLength(0);
    expect(problems[0].reasons[0]).toMatch(/Closest: Business Analyst/);
    expect(unknownRoles).toEqual(["Lead Business Person"]);
  });

  it("resolves every additional role too", () => {
    const { parsed } = read(
      csv({ full_name: "Sipho Dlamini", additional_roles: "BA | Systems Analyst" }),
    );
    expect(parsed[0].additional_roles).toEqual(["Business Analyst", "Systems Analyst"]);
  });

  it("rejects an address that is not one", () => {
    const { problems } = read(csv({ full_name: "Sipho Dlamini", email: "sipho at example" }));
    expect(problems[0].reasons[0]).toMatch(/is not an email address/);
  });

  it("refuses the template's own example row", () => {
    // Forgetting to delete it is the likeliest mistake anybody makes with a
    // filled-in template, and nobody wants Thandiwe Mokoena in their database.
    const { problems } = read(
      csv({ full_name: "Thandiwe Mokoena", email: "t.mokoena@example.co.za" }),
    );
    expect(problems[0].reasons.join(" ")).toMatch(/example row from the template/);
  });

  it("warns when a person can only ever be matched by name", () => {
    const { parsed } = read(csv({ full_name: "Sipho Dlamini" }));
    expect(parsed[0].warnings.join(" ")).toMatch(/only be matched by name/);
  });

  it("warns when somebody on notice has no date, since they read as free today", () => {
    const { parsed } = read(
      csv({ full_name: "Sipho Dlamini", email: "s@d.co.za", availability: "notice_period" }),
    );
    expect(parsed[0].warnings.join(" ")).toMatch(/read as free today/);
  });

  it("suggests categories from the skills rather than inventing them", () => {
    const { parsed } = read(
      csv({ full_name: "Sipho Dlamini", email: "s@d.co.za", technical_skills: "Power BI | SQL" }),
    );
    expect(parsed[0].resource_categories).toEqual([]);
    expect(parsed[0].warnings.join(" ")).toMatch(/suggest Data & BI/);
  });

  it("splits every list on a pipe", () => {
    const { parsed } = read(
      csv({
        full_name: "Sipho Dlamini",
        email: "s@d.co.za",
        qualifications: "BCom Information Systems | Matric",
        languages: "English | isiZulu",
      }),
    );
    expect(parsed[0].qualifications).toEqual(["BCom Information Systems", "Matric"]);
    expect(parsed[0].languages).toEqual(["English", "isiZulu"]);
  });
});

describe("buildCandidatePlan", () => {
  it("creates somebody nobody has on file", () => {
    const { parsed } = read(csv({ full_name: "Sipho Dlamini", email: "s@d.co.za" }));
    const plan = buildCandidatePlan(parsed, []);
    expect(plan.summary).toEqual({ create: 1, update: 0, unchanged: 0, reject: 0 });
  });

  it("recognises a person by their address", () => {
    const { parsed } = read(
      csv({ full_name: "Thandiwe Mokoena", email: "T.Mokoena@TippFocus.co.za", location: "Pretoria" }),
    );
    const plan = buildCandidatePlan(parsed, [stored({})]);
    const p = plan.plans[0];
    expect(p.kind).toBe("update");
    if (p.kind !== "update") return;
    expect(p.matchedOn).toBe("email");
    expect(p.changes).toEqual([{ column: "location", from: null, to: "Pretoria" }]);
  });

  it("does not rewrite an address that differs only in case", () => {
    // Otherwise the first import rewrites the casing of every address in the
    // pool and buries the real changes in the report.
    const { parsed } = read(
      csv({ full_name: "Thandiwe Mokoena", email: "T.Mokoena@TippFocus.co.za" }),
    );
    const plan = buildCandidatePlan(parsed, [stored()]);
    expect(plan.plans[0].kind).toBe("unchanged");
  });

  it("does not rewrite a number written in another format", () => {
    const { parsed } = read(
      csv({ full_name: "Thandiwe Mokoena", phone: "+27 82 555 0143" }),
    );
    const plan = buildCandidatePlan(parsed, [
      stored({ email: null, phone: "082 555 0143", columns: { email: null, phone: "082 555 0143" } }),
    ]);
    expect(plan.plans[0].kind).toBe("unchanged");
  });

  it("recognises a person whose number is written differently", () => {
    const { parsed } = read(
      csv({ full_name: "Thandiwe Mokoena", phone: "+27 82 555 0143", location: "Durban" }),
    );
    const plan = buildCandidatePlan(parsed, [
      stored({ email: null, phone: "082 555 0143", columns: { email: null, phone: "082 555 0143" } }),
    ]);
    const p = plan.plans[0];
    expect(p.kind).toBe("update");
    if (p.kind !== "update") return;
    expect(p.matchedOn).toBe("phone");
  });

  it("falls back to a name only when there is nothing better, and says so", () => {
    const { parsed } = read(csv({ full_name: "Thandiwe Mokoena", location: "Cape Town" }));
    const plan = buildCandidatePlan(parsed, [stored({})]);
    const p = plan.plans[0];
    expect(p.kind).toBe("update");
    if (p.kind !== "update") return;
    expect(p.matchedOn).toBe("name");
  });

  it("does not merge two people who happen to share a name", () => {
    // The row carries an address, so the name is not consulted. Creating a
    // second record is recoverable; silently merging two people is not.
    const { parsed } = read(
      csv({ full_name: "Thandiwe Mokoena", email: "different.person@example.co.za" }),
    );
    const plan = buildCandidatePlan(parsed, [stored({})]);
    expect(plan.plans[0].kind).toBe("create");
    if (plan.plans[0].kind !== "create") return;
    expect(plan.plans[0].row.warnings.join(" ")).toMatch(/already on file under different contact/);
  });

  it("rejects rather than guesses when a name matches two people", () => {
    const { parsed } = read(csv({ full_name: "Thandiwe Mokoena", location: "Cape Town" }));
    const plan = buildCandidatePlan(parsed, [
      stored({ id: "c1", email: null, columns: { email: null } }),
      stored({ id: "c2", email: null, columns: { email: null } }),
    ]);
    expect(plan.plans[0].kind).toBe("reject");
  });

  it("rejects the same address appearing twice in one file", () => {
    const { parsed } = read(
      csv(
        { full_name: "Sipho Dlamini", email: "s@d.co.za" },
        { full_name: "S Dlamini", email: "S@D.co.za" },
      ),
    );
    const plan = buildCandidatePlan(parsed, []);
    expect(plan.summary.reject).toBe(2);
    expect(plan.summary.create).toBe(0);
  });

  it("never clears a stored value from a blank cell", () => {
    // This is what makes the file safe to send back after somebody has been
    // corrected in the app.
    const { parsed } = read(csv({ full_name: "Thandiwe Mokoena", email: "t.mokoena@tippfocus.co.za" }));
    const plan = buildCandidatePlan(parsed, [
      stored({ columns: { location: "Johannesburg", skills: ["UAT"] } }),
    ]);
    const p = plan.plans[0];
    expect(p.kind).toBe("unchanged");
    if (p.kind !== "unchanged") return;
  });

  it("reports what a blank cell left alone when there is something else to change", () => {
    const { parsed } = read(
      csv({ full_name: "Thandiwe Mokoena", email: "t.mokoena@tippfocus.co.za", notes: "Prefers Gauteng" }),
    );
    const plan = buildCandidatePlan(parsed, [stored({ columns: { location: "Johannesburg" } })]);
    const p = plan.plans[0];
    expect(p.kind).toBe("update");
    if (p.kind !== "update") return;
    expect(p.leftAlone).toContain("location");
    expect(p.changes).toEqual([{ column: "notes", from: null, to: "Prefers Gauteng" }]);
  });

  it("reports every row unchanged on a second pass", () => {
    // The idempotency check, and it happens before anything is written.
    const text = csv({
      full_name: "Thandiwe Mokoena",
      email: "t.mokoena@tippfocus.co.za",
      location: "Johannesburg",
      current_role: "ERP Consultant",
      skills: "UAT | Business Process Analysis",
      availability: "notice_period",
      available_from: "2026-11-01",
      resource_categories: "ERP",
    });
    const { parsed } = read(text);
    const first = buildCandidatePlan(parsed, [stored({})]);
    expect(first.summary.update).toBe(1);

    const after = stored({
      columns: {
        location: "Johannesburg",
        current_role: "ERP Consultant",
        skills: ["UAT", "Business Process Analysis"],
        availability: "notice_period",
        available_from: "2026-11-01",
        resource_categories: ["ERP"],
      },
    });
    const second = buildCandidatePlan(read(text).parsed, [after]);
    expect(second.summary).toEqual({ create: 0, update: 0, unchanged: 1, reject: 0 });
  });

  describe("against a candidate loaded from a CV", () => {
    const withCv = (columns: Record<string, unknown>) =>
      stored({ hasCv: true, columns });

    it("refuses to replace what the CV already answered", () => {
      // A row typed in a hurry holds three skills where a parsed CV holds
      // twenty-two. Letting the sheet win would be a downgrade nobody asked for.
      const { parsed } = read(
        csv({
          full_name: "Thandiwe Mokoena",
          email: "t.mokoena@tippfocus.co.za",
          skills: "UAT",
        }),
      );
      const plan = buildCandidatePlan(parsed, [
        withCv({ skills: ["UAT", "Business Process Analysis", "Requirements Gathering"] }),
      ]);
      const p = plan.plans[0];
      expect(p.kind).toBe("unchanged");
    });

    it("says which column it declined when there is anything else to do", () => {
      const { parsed } = read(
        csv({
          full_name: "Thandiwe Mokoena",
          email: "t.mokoena@tippfocus.co.za",
          skills: "UAT",
          availability: "unavailable",
        }),
      );
      const plan = buildCandidatePlan(parsed, [
        withCv({ skills: ["UAT", "Business Process Analysis"] }),
      ]);
      const p = plan.plans[0];
      expect(p.kind).toBe("update");
      if (p.kind !== "update") return;
      expect(p.declined.map((d) => d.column)).toEqual(["skills"]);
      expect(p.changes.map((c) => c.column)).toEqual(["availability"]);
    });

    it("still fills a column the CV left empty", () => {
      // Old CVs carry no designated group, and filling that hole across a whole
      // pool is one of the two jobs this importer exists for.
      const { parsed } = read(
        csv({
          full_name: "Thandiwe Mokoena",
          email: "t.mokoena@tippfocus.co.za",
          designated_group: "African Female",
        }),
      );
      const plan = buildCandidatePlan(parsed, [withCv({ designated_group: null })]);
      const p = plan.plans[0];
      expect(p.kind).toBe("update");
      if (p.kind !== "update") return;
      expect(p.changes).toEqual([
        { column: "designated_group", from: null, to: "African Female" },
      ]);
      expect(p.declined).toEqual([]);
    });

    it("always writes the five columns no CV carries", () => {
      const { parsed } = read(
        csv({
          full_name: "Thandiwe Mokoena",
          email: "t.mokoena@tippfocus.co.za",
          availability: "notice_period",
          available_from: "2026-11-01",
          status: "inactive",
          resource_categories: "ERP | Business Analysis",
          notes: "Back in November",
        }),
      );
      const plan = buildCandidatePlan(parsed, [
        withCv({ availability: "available", status: "active", notes: null }),
      ]);
      const p = plan.plans[0];
      expect(p.kind).toBe("update");
      if (p.kind !== "update") return;
      expect(p.changes.map((c) => c.column).sort()).toEqual([
        "availability",
        "available_from",
        "notes",
        "resource_categories",
        "status",
      ]);
      expect(p.declined).toEqual([]);
    });
  });
});
