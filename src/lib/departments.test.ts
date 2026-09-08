import { describe, it, expect } from "vitest";
import {
  resolveTenderDepartment,
  resolveImportDepartment,
  departmentName,
  type DepartmentOption,
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
