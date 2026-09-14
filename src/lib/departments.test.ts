import { describe, it, expect } from "vitest";
import {
  defaultTenderDepartment,
  resolveTenderDepartment,
  resolveImportDepartment,
  departmentName,
  resolveLens,
  activeDepartment,
  defaultCandidateDepartments,
  knownDepartmentIds,
  parseDepartmentFilter,
  shortlistDepartmentNote,
  type DepartmentOption,
  type DepartmentBrand,
} from "@/lib/departments";

const DEPARTMENTS: DepartmentOption[] = [
  { id: "d1", name: "Tipp Consulting", slug: "consulting" },
  { id: "d2", name: "Tipp Resourcing", slug: "resourcing" },
  { id: "d3", name: "Tipp Human Capital", slug: "human-capital" },
  { id: "d4", name: "Tipp Construction", slug: "construction" },
];

describe("resolveTenderDepartment", () => {
  it("files a manager's bid in their own department without asking", () => {
    const result = resolveTenderDepartment({
      isAdmin: false,
      creatorDepartmentId: "d1",
      submittedDepartmentId: null,
      departments: DEPARTMENTS,
    });
    expect(result).toEqual({ departmentId: "d1", error: null });
  });

  it("ignores a department a manager tries to submit", () => {
    // The security case. The value that decides who can see a bid is never
    // taken from the client, not even to be validated.
    const result = resolveTenderDepartment({
      isAdmin: false,
      creatorDepartmentId: "d1",
      submittedDepartmentId: "d4",
      departments: DEPARTMENTS,
    });
    expect(result.departmentId).toBe("d1");
  });

  it("tells a manager with no department what to do about it", () => {
    const result = resolveTenderDepartment({
      isAdmin: false,
      creatorDepartmentId: null,
      submittedDepartmentId: "d1",
      departments: DEPARTMENTS,
    });
    expect(result.departmentId).toBeNull();
    expect(result.error).toMatch(/not assigned to a department/);
  });

  it("lets an admin file into any department", () => {
    const result = resolveTenderDepartment({
      isAdmin: true,
      creatorDepartmentId: null,
      submittedDepartmentId: "d4",
      departments: DEPARTMENTS,
    });
    expect(result).toEqual({ departmentId: "d4", error: null });
  });

  it("falls back to an admin's own department when they pick nothing", () => {
    const result = resolveTenderDepartment({
      isAdmin: true,
      creatorDepartmentId: "d2",
      submittedDepartmentId: null,
      departments: DEPARTMENTS,
    });
    expect(result.departmentId).toBe("d2");
  });

  it("ignores an id that is not a department, rather than writing it", () => {
    const result = resolveTenderDepartment({
      isAdmin: true,
      creatorDepartmentId: "d2",
      submittedDepartmentId: "d9-deleted",
      departments: DEPARTMENTS,
    });
    expect(result.departmentId).toBe("d2");
  });

  it("asks an admin with no department to choose", () => {
    const result = resolveTenderDepartment({
      isAdmin: true,
      creatorDepartmentId: null,
      submittedDepartmentId: null,
      departments: DEPARTMENTS,
    });
    expect(result.departmentId).toBeNull();
    expect(result.error).toMatch(/Pick a department/);
  });

  it("does not let an admin fall back to a department that no longer exists", () => {
    const result = resolveTenderDepartment({
      isAdmin: true,
      creatorDepartmentId: "d9-deleted",
      submittedDepartmentId: null,
      departments: DEPARTMENTS,
    });
    expect(result.error).toMatch(/Pick a department/);
  });
});

describe("defaultTenderDepartment", () => {
  const departments = [
    { id: "r", name: "Tipp Resourcing", slug: "resourcing" },
    { id: "c", name: "Tipp Consulting", slug: "consulting" },
  ];

  it("files an admin with no department of their own under Consulting", () => {
    expect(defaultTenderDepartment(departments, null)).toBe("c");
  });

  it("leaves the choice open when the admin has a department, which the server falls back to", () => {
    expect(defaultTenderDepartment(departments, "Tipp Resourcing")).toBeNull();
  });

  it("has nothing to offer when Consulting is not among the departments", () => {
    expect(defaultTenderDepartment([departments[0]], null)).toBeNull();
    expect(defaultTenderDepartment([], null)).toBeNull();
  });

  it("files under the department an admin is looking through, before Consulting", () => {
    expect(defaultTenderDepartment(departments, null, "r")).toBe("r");
    expect(defaultTenderDepartment(departments, null, "unknown")).toBe("c");
    expect(defaultTenderDepartment(departments, "Tipp Resourcing", "r")).toBeNull();
  });
});

const BRANDS: DepartmentBrand[] = [
  { id: "d1", name: "Tipp Consulting", slug: "consulting", colour: "#68252C" },
  { id: "d2", name: "Tipp Resourcing", slug: "resourcing", colour: "#2CB673" },
  { id: "d4", name: "Tipp Construction", slug: "construction", colour: null },
];

describe("resolveLens and activeDepartment", () => {
  it("reads the cookie back to a department, or nothing", () => {
    expect(resolveLens("construction", BRANDS)?.id).toBe("d4");
    expect(resolveLens("marketing", BRANDS)).toBeNull();
    expect(resolveLens(undefined, BRANDS)).toBeNull();
  });

  it("is the person's own department, or the admin's chosen one, and never a lens on anybody else", () => {
    expect(activeDepartment({ isAdmin: false, own: BRANDS[0], lens: BRANDS[1] })?.id).toBe("d1");
    expect(activeDepartment({ isAdmin: true, own: null, lens: BRANDS[1] })?.id).toBe("d2");
    expect(activeDepartment({ isAdmin: true, own: BRANDS[0], lens: null })).toBeNull();
    expect(defaultCandidateDepartments(BRANDS[2])).toEqual(["d4"]);
    expect(defaultCandidateDepartments(null)).toEqual([]);
  });
});

describe("knownDepartmentIds", () => {
  it("keeps real departments once each in their own order and drops the rest", () => {
    expect(knownDepartmentIds(["d4", "nope", "d1", "d4", 7, null], BRANDS)).toEqual(["d1", "d4"]);
    expect(knownDepartmentIds("d1", BRANDS)).toEqual([]);
    expect(knownDepartmentIds(undefined, BRANDS)).toEqual([]);
  });
});

describe("parseDepartmentFilter", () => {
  it("defaults to the person's own department and honours an explicit all or none", () => {
    expect(parseDepartmentFilter(undefined, "d1", BRANDS)).toEqual({ kind: "one", department: BRANDS[0] });
    expect(parseDepartmentFilter("all", "d1", BRANDS)).toEqual({ kind: "all" });
    expect(parseDepartmentFilter("none", "d1", BRANDS)).toEqual({ kind: "none" });
    expect(parseDepartmentFilter("d2", "d1", BRANDS)).toEqual({ kind: "one", department: BRANDS[1] });
  });

  it("shows everyone when there is no default and when the value names nobody", () => {
    expect(parseDepartmentFilter(undefined, null, BRANDS)).toEqual({ kind: "all" });
    expect(parseDepartmentFilter("gone", "d1", BRANDS)).toEqual({ kind: "all" });
  });
});

describe("shortlistDepartmentNote", () => {
  it("says nothing for the bid's own people and for a bid with no department", () => {
    expect(shortlistDepartmentNote(["d1", "d2"], "d1", BRANDS)).toBeNull();
    expect(shortlistDepartmentNote(["d2"], null, BRANDS)).toBeNull();
  });

  it("names where a borrowed person is filed, or that they are filed nowhere", () => {
    expect(shortlistDepartmentNote(["d2", "d4"], "d1", BRANDS)).toEqual({ kind: "outside", departments: [BRANDS[1], BRANDS[2]] });
    expect(shortlistDepartmentNote([], "d1", BRANDS)).toEqual({ kind: "none" });
    expect(shortlistDepartmentNote(undefined, "d1", BRANDS)).toEqual({ kind: "none" });
  });
});

describe("resolveImportDepartment", () => {
  it("reads a department by name", () => {
    expect(resolveImportDepartment("Tipp Construction", null, DEPARTMENTS).departmentId).toBe("d4");
  });

  it("does not care about case or padding", () => {
    expect(resolveImportDepartment("  tipp human capital ", null, DEPARTMENTS).departmentId).toBe(
      "d3",
    );
  });

  it("reads the slug too, since that is what survives a rename", () => {
    expect(resolveImportDepartment("resourcing", null, DEPARTMENTS).departmentId).toBe("d2");
  });

  it("refuses a name it does not know, and lists the real ones", () => {
    // The importer runs on the service-role key, which bypasses RLS, so nothing
    // underneath would catch this. A typo would file bids where their owners
    // cannot see them.
    const result = resolveImportDepartment("Tipp Consluting", "d1", DEPARTMENTS);
    expect(result.departmentId).toBeNull();
    expect(result.error).toMatch(/is not a department/);
    expect(result.error).toMatch(/Tipp Consulting, Tipp Resourcing/);
  });

  it("falls back to the operator's own department when the cell is blank", () => {
    expect(resolveImportDepartment("", "d2", DEPARTMENTS).departmentId).toBe("d2");
    expect(resolveImportDepartment(null, "d2", DEPARTMENTS).departmentId).toBe("d2");
  });

  it("refuses rather than guessing when there is nothing to fall back on", () => {
    // True of every current admin, who have no department at all.
    const result = resolveImportDepartment(null, null, DEPARTMENTS);
    expect(result.departmentId).toBeNull();
    expect(result.error).toMatch(/operator has none to fall back on/);
  });

  it("refuses an operator department that no longer exists", () => {
    expect(resolveImportDepartment(null, "d9-deleted", DEPARTMENTS).departmentId).toBeNull();
  });
});

describe("departmentName", () => {
  it("names a department", () => {
    expect(departmentName("d3", DEPARTMENTS)).toBe("Tipp Human Capital");
  });

  it("has nothing to say about an admin with no department", () => {
    expect(departmentName(null, DEPARTMENTS)).toBeNull();
  });

  it("does not invent a name for an id it does not know", () => {
    expect(departmentName("d9", DEPARTMENTS)).toBeNull();
  });
});
