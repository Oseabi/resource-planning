import { describe, expect, it } from "vitest";
import { roleOptions } from "@/lib/role-filter";

describe("roleOptions", () => {
  const roles = [
    "Senior Java Developer",
    "Java Developer",
    "Specialist Test Analyst/QA Engineer",
    "Project Manager",
    "Senior Project Manager",
    null,
    "",
  ];

  it("offers only roles somebody holds, with the count the filter would show", () => {
    const opts = roleOptions(roles);
    const byRole = Object.fromEntries(opts.map((o) => [o.role, o.count]));
    expect(byRole["Java Developer"]).toBe(2);
    expect(byRole["Test Analyst"]).toBe(1);
    expect(byRole["QA Engineer"]).toBe(1);
    // Substring, as the list's ilike: "Senior Project Manager" holds both.
    expect(byRole["Project Manager"]).toBe(2);
    expect(byRole["Senior Project Manager"]).toBe(1);
    expect(byRole["Registered Nurse"]).toBeUndefined();
  });

  it("puts the most common first", () => {
    const counts = roleOptions(roles).map((o) => o.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("keeps a selected role nobody holds, so the control can show it", () => {
    expect(roleOptions(roles, "Registered Nurse")[0]).toEqual({ role: "Registered Nurse", count: 0 });
    expect(roleOptions(roles, "java developer").filter((o) => o.role.toLowerCase() === "java developer")).toHaveLength(1);
  });
});
