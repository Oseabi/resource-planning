import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv";
import {
  parseImportDate,
  parseMoney,
  parseList,
  parseStatus,
  parseSeatsCell,
  buildRoleIndex,
  resolveRole,
  readRows,
  reconcileSeats,
  buildPlan,
  rolesFromSeats,
  type ExistingTender,
  type ExistingPosition,
} from "@/lib/tender-import";

const ROLES = ["Business Analyst", "Project Manager", "Data Engineer", "Systems Analyst", "Quantity Surveyor"];
const index = buildRoleIndex(ROLES, []);

describe("parseImportDate", () => {
  it("accepts an unambiguous date", () => {
    expect(parseImportDate("2026-03-01").date).toBe("2026-03-01");
    expect(parseImportDate("2026/03/01").date).toBe("2026-03-01");
  });

  it("rejects a date whose day and month order is a guess", () => {
    // Guessing wrong gives a contract that ends in the wrong month, and nothing
    // notices until somebody tries to extend it.
    expect(parseImportDate("01/03/2026").error).toMatch(/unambiguous/);
    expect(parseImportDate("1 Mar 2026").error).toMatch(/unambiguous/);
  });

  it("rejects an Excel serial number", () => {
    expect(parseImportDate("45017").error).toMatch(/unambiguous/);
  });

  it("rejects a date that does not exist", () => {
    expect(parseImportDate("2026-02-30").error).toMatch(/not a real date/);
  });

  it("treats an empty cell as absent, not an error", () => {
    expect(parseImportDate("")).toEqual({ date: null, error: null });
  });
});

describe("parseMoney", () => {
  it("reads the ways a register writes rands", () => {
    expect(parseMoney("R 12 500 000").amount).toBe(12500000);
    expect(parseMoney("12,500,000").amount).toBe(12500000);
    expect(parseMoney("12500000.50").amount).toBe(12500000.5);
  });

  it("reads a non-breaking space, which Excel writes and nobody can see", () => {
    expect(parseMoney("R 12 500 000").amount).toBe(12500000);
  });

  it("rejects anything it would have to guess at", () => {
    expect(parseMoney("1,5").amount).toBe(15); // unambiguous once separators go
    expect(parseMoney("about 12m").error).toMatch(/not a number/);
  });
});

describe("parseStatus", () => {
  it("reads the five, whatever the casing", () => {
    expect(parseStatus("Won")).toBe("won");
    expect(parseStatus("SUBMITTED")).toBe("submitted");
    expect(parseStatus("")).toBe("draft");
  });

  it("rejects a status it does not know rather than defaulting it", () => {
    // Defaulting to draft would quietly turn won bids into drafts and nothing
    // downstream would look wrong.
    expect(parseStatus("awarded")).toBeNull();
    expect(parseStatus("in progress")).toBeNull();
  });
});

describe("parseList", () => {
  it("splits on pipes and drops the gaps", () => {
    expect(parseList("SQL | Power BI ||  Excel ")).toEqual(["SQL", "Power BI", "Excel"]);
    expect(parseList("")).toEqual([]);
  });
});

describe("resolveRole", () => {
  it("takes an exact role however it was typed", () => {
    expect(resolveRole("business  analyst", index)).toMatchObject({ role: "Business Analyst", via: "exact" });
  });

  it("expands a known abbreviation and says that it did", () => {
    expect(resolveRole("BA", index)).toMatchObject({ role: "Business Analyst", via: "alias" });
  });

  it("rejects an unknown role and offers the nearest known ones", () => {
    const r = resolveRole("Lead Analyst", index);
    expect(r.role).toBeNull();
    expect(r.suggestions).toContain("Systems Analyst");
  });

  it("accepts a role the candidate pool uses even if the vocabulary does not", () => {
    const withPool = buildRoleIndex(ROLES, ["D365 Functional Consultant"]);
    expect(resolveRole("d365 functional consultant", withPool).role).toBe("D365 Functional Consultant");
  });
});

describe("parseSeatsCell", () => {
  it("reads quantity, role and experience floor", () => {
    const r = parseSeatsCell("3 x Business Analyst @5 | Project Manager", null, index);
    expect(r.errors).toEqual([]);
    expect(r.seats).toEqual([
      { role: "Business Analyst", quantity: 3, min_experience_years: 5 },
      { role: "Project Manager", quantity: 1, min_experience_years: null },
    ]);
  });

  it("falls back to the row's experience floor", () => {
    const r = parseSeatsCell("2 x Data Engineer", 3, index);
    expect(r.seats[0].min_experience_years).toBe(3);
  });

  it("reports the expansion when an abbreviation was used", () => {
    const r = parseSeatsCell("2 x BA", null, index);
    expect(r.seats[0].role).toBe("Business Analyst");
    expect(r.notes[0]).toMatch(/read as/);
  });

  it("rejects a role it does not know", () => {
    const r = parseSeatsCell("2 x Snr Widget Wrangler", null, index);
    expect(r.seats).toEqual([]);
    expect(r.errors[0]).toMatch(/not a known role/);
  });

  it("rejects the same role twice at the same level", () => {
    // Re-running could not tell the two lines apart, so the quantity has to be
    // combined in the sheet.
    const r = parseSeatsCell("1 x Business Analyst @5 | 2 x Business Analyst @5", null, index);
    expect(r.errors.some((e) => /appears twice/.test(e))).toBe(true);
  });

  it("allows the same role at different levels", () => {
    // "Three analysts at 3 years and a lead at 5" is two legitimate lines.
    const r = parseSeatsCell("3 x Business Analyst @3 | 1 x Business Analyst @8", null, index);
    expect(r.errors).toEqual([]);
    expect(r.seats).toHaveLength(2);
  });

  it("reads an empty cell as no seats", () => {
    expect(parseSeatsCell("", null, index).seats).toEqual([]);
  });
});

const HEADERS = "title,reference_number,client,status,contract_start_date,contract_end_date,value,seats";
const rows = (body: string) => readRows(parseCsv(`${HEADERS}\n${body}`), index);

describe("readRows", () => {
  it("refuses the template's own example row", () => {
    // Forgetting to delete it is the likeliest mistake anybody makes with a
    // filled-in template, and it would otherwise create a tender for a bid that
    // does not exist.
    const { problems } = rows(
      "Provision of ERP support and maintenance services,SCM/2026/0148,City of Cape Town,live,,,,Project Manager",
    );
    expect(problems[0].reasons.join(" ")).toMatch(/example row from the template/);
  });

  it("reads a complete row", () => {
    const { parsed, problems } = rows(
      "ERP support,REF-1,Eskom,live,2026-04-01,2028-03-31,R 12 500 000,3 x Business Analyst @5 | Project Manager",
    );
    expect(problems).toEqual([]);
    expect(parsed[0]).toMatchObject({
      title: "ERP support",
      reference_number: "REF-1",
      client: "Eskom",
      status: "live",
      contract_start_date: "2026-04-01",
      value: 12500000,
    });
    expect(parsed[0].seats).toHaveLength(2);
  });

  it("rejects an unrecognised column", () => {
    // A header typo that silently drops the contract end date for a hundred
    // rows is found six months later.
    const t = readRows(parseCsv("title,contarct_end_date\nERP,2026-01-01\n"), index);
    expect(t.parsed).toEqual([]);
    expect(t.problems[0].reasons[0]).toMatch(/unrecognised column/);
  });

  it("rejects a file with no title column", () => {
    const t = readRows(parseCsv("client,value\nEskom,100\n"), index);
    expect(t.problems[0].reasons[0]).toMatch(/missing column/);
  });

  it("rejects a contract that ends before it starts", () => {
    const t = rows("ERP,REF-1,Eskom,won,2027-01-01,2026-01-01,,Business Analyst");
    expect(t.problems[0].reasons).toContain("the contract ends before it starts");
  });

  it("rejects a live bid with no seats", () => {
    // Coverage cannot answer for a bid that does not say what it needs.
    const t = rows("ERP,REF-1,Eskom,live,,,,");
    expect(t.problems[0].reasons.some((r) => /staffed with/.test(r))).toBe(true);
  });

  it("accepts a draft with no seats", () => {
    const t = rows("ERP,REF-1,Eskom,draft,,,,");
    expect(t.problems).toEqual([]);
    expect(t.parsed[0].seats).toEqual([]);
  });

  it("warns without blocking on a won bid with no contract dates", () => {
    const t = rows("ERP,REF-1,Eskom,won,,,,Business Analyst");
    expect(t.problems).toEqual([]);
    expect(t.parsed[0].warnings.some((w) => /coverage/.test(w))).toBe(true);
  });

  it("records which columns the row left blank", () => {
    const t = rows("ERP,,,draft,,,,");
    expect(t.parsed[0].blankColumns).toContain("client");
    expect(t.parsed[0].blankColumns).toContain("value");
  });
});

describe("reconcileSeats", () => {
  const existing = (over: Partial<ExistingPosition>): ExistingPosition => ({
    id: "p1",
    role: "Business Analyst",
    quantity: 2,
    min_experience_years: 5,
    assignments: 0,
    ...over,
  });

  it("keeps the existing id when role and experience both match", () => {
    // This is what lets a re-run leave the assignments and shortlist on that
    // seat alone. Delete and re-insert would throw them away every time.
    const plan = reconcileSeats(
      [existing({})],
      [{ role: "Business Analyst", quantity: 3, min_experience_years: 5 }],
    );
    expect(plan.positions[0].id).toBe("p1");
    expect(plan.positions[0].quantity).toBe(3);
    expect(plan.changed).toBe(true);
  });

  it("reports no change when the seats already match", () => {
    const plan = reconcileSeats(
      [existing({})],
      [{ role: "Business Analyst", quantity: 2, min_experience_years: 5 }],
    );
    expect(plan.changed).toBe(false);
    expect(plan.removed).toEqual([]);
  });

  it("adds a line with no id", () => {
    const plan = reconcileSeats([], [{ role: "Data Engineer", quantity: 1, min_experience_years: null }]);
    expect(plan.positions[0].id).toBeUndefined();
  });

  it("removes an empty seat that the register dropped", () => {
    const plan = reconcileSeats([existing({})], []);
    expect(plan.removed).toEqual([{ id: "p1", role: "Business Analyst" }]);
    expect(plan.positions).toEqual([]);
  });

  it("refuses to remove a seat somebody is sitting in", () => {
    // A spreadsheet does not get to take a person out of a chair.
    const plan = reconcileSeats([existing({ assignments: 1 })], []);
    expect(plan.removed).toEqual([]);
    expect(plan.blocked).toEqual([{ id: "p1", role: "Business Analyst", assignments: 1 }]);
    expect(plan.positions[0].id).toBe("p1");
  });

  it("keeps two lines of one role at different experience levels", () => {
    const plan = reconcileSeats(
      [existing({ id: "p1", min_experience_years: 3 }), existing({ id: "p2", min_experience_years: 8 })],
      [
        { role: "Business Analyst", quantity: 2, min_experience_years: 3 },
        { role: "Business Analyst", quantity: 2, min_experience_years: 8 },
      ],
    );
    expect(plan.positions.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(plan.removed).toEqual([]);
  });
});

describe("buildPlan", () => {
  const stored = (over: Partial<ExistingTender>): ExistingTender => ({
    id: "t1",
    reference_number: "REF-1",
    title: "ERP support",
    client: "Eskom",
    columns: {
      title: "ERP support",
      reference_number: "REF-1",
      client: "Eskom",
      location: null,
      value: 12500000,
      submission_deadline: null,
      contract_start_date: "2026-04-01",
      contract_end_date: null,
      status: "live",
      min_experience_years: null,
      required_skills: [],
      required_certifications: [],
      sectors: [],
    },
    positions: [{ id: "p1", role: "Business Analyst", quantity: 3, min_experience_years: 5, assignments: 0 }],
    ...over,
  });

  const line = "ERP support,REF-1,Eskom,live,2026-04-01,,R 12 500 000,3 x Business Analyst @5";

  it("creates when nothing matches", () => {
    const { parsed } = rows(line);
    expect(buildPlan(parsed, []).summary).toMatchObject({ create: 1, update: 0 });
  });

  it("reports unchanged on a second pass over the same input", () => {
    // The idempotency check. If this does not hold, a re-run after fixing the
    // spreadsheet rewrites records that did not need touching.
    const { parsed } = rows(line);
    const plan = buildPlan(parsed, [stored({})]);
    expect(plan.summary).toMatchObject({ unchanged: 1, create: 0, update: 0 });
  });

  it("updates the columns the register actually changed", () => {
    const { parsed } = rows("ERP support,REF-1,Eskom,live,2026-04-01,2028-03-31,R 12 500 000,3 x Business Analyst @5");
    const plan = buildPlan(parsed, [stored({})]);
    const update = plan.plans[0];
    expect(update.kind).toBe("update");
    if (update.kind !== "update") return;
    expect(update.columnChanges).toEqual([
      { column: "contract_end_date", from: null, to: "2028-03-31" },
    ]);
  });

  it("never lets a blank cell erase a stored value", () => {
    // A blank means "not in the register", not "clear this". Without it, a
    // re-run silently wipes every correction made in the app.
    const { parsed } = rows("ERP support,REF-1,,live,2026-04-01,,,3 x Business Analyst @5");
    const plan = buildPlan(parsed, [stored({})]);
    const p = plan.plans[0];
    if (p.kind !== "unchanged" && p.kind !== "update") throw new Error("expected a match");
    if (p.kind === "update") {
      expect(p.columnChanges.map((c) => c.column)).not.toContain("client");
      expect(p.leftAlone).toContain("client");
    }
  });

  it("matches on title and client when the reference is blank", () => {
    const { parsed } = rows("ERP support,,Eskom,live,2026-04-01,,R 12 500 000,3 x Business Analyst @5");
    const plan = buildPlan(parsed, [stored({ reference_number: null })]);
    expect(plan.summary.create).toBe(0);
  });

  it("rejects rather than duplicates when title and client match twice", () => {
    const { parsed } = rows("ERP support,,Eskom,live,2026-04-01,,R 12 500 000,3 x Business Analyst @5");
    const plan = buildPlan(parsed, [
      stored({ id: "t1", reference_number: null }),
      stored({ id: "t2", reference_number: null }),
    ]);
    expect(plan.summary.reject).toBe(1);
    expect(plan.summary.create).toBe(0);
  });

  it("rejects a reference that appears twice in the file", () => {
    const { parsed } = rows(`${line}\nOther bid,REF-1,SANRAL,draft,,,,`);
    const plan = buildPlan(parsed, []);
    expect(plan.summary.reject).toBe(2);
    expect(plan.summary.create).toBe(0);
  });
});

describe("rolesFromSeats", () => {
  it("lists each role once, for the tags on the detail page", () => {
    expect(
      rolesFromSeats([
        { role: "Business Analyst", quantity: 3, min_experience_years: 3 },
        { role: "Business Analyst", quantity: 1, min_experience_years: 8 },
        { role: "Data Engineer", quantity: 1, min_experience_years: null },
      ]),
    ).toEqual(["Business Analyst", "Data Engineer"]);
  });
});

describe("roles the vocabulary does not carry", () => {
  it("gathers every unknown spelling in the file, once each", () => {
    // Reported together rather than row by row, so one pass settles them all
    // instead of the same spelling being rediscovered on thirty rows.
    const t = readRows(
      parseCsv(
        `${HEADERS}\n` +
          "A,R1,C,live,,,,2 x Actuary\n" +
          "B,R2,C,live,,,,1 x Actuary | 1 x Town Planner\n",
      ),
      index,
    );
    expect(t.unknownRoles).toEqual(["Actuary", "Town Planner"]);
  });

  it("accepts a role the operator has confirmed for this run", () => {
    // The vocabulary cannot know every discipline TiPP bids on. Blocking the
    // whole register on a legitimate role would make the check something people
    // work around, which is worse than the check not existing.
    const withAccepted = buildRoleIndex(ROLES, [], ["Actuary"]);
    const t = readRows(parseCsv(`${HEADERS}\nA,R1,C,live,,,,2 x Actuary\n`), withAccepted);
    expect(t.problems).toEqual([]);
    expect(t.unknownRoles).toEqual([]);
    expect(t.parsed[0].seats[0].role).toBe("Actuary");
  });

  it("reports nothing unknown when every role is recognised", () => {
    const t = rows("A,R1,C,live,,,,2 x Business Analyst");
    expect(t.unknownRoles).toEqual([]);
  });
});
