import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_TENDER } from "@/app/(app)/tenders/empty-tender";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("the blank tender the create page starts from", () => {
  it("lives in a module a server component can actually read", () => {
    // The whole reason this module exists. A constant exported from a
    // "use client" module arrives on the server as a reference, not a value:
    // React lets a server component pass that name through to a client
    // component, but spreading it yields an empty object in silence. The
    // create page spreads this one, so when it lived in tender-fields.tsx
    // every field disappeared and the page threw before it rendered.
    // The directive only counts as one when it is the first statement, so
    // the check looks there rather than anywhere in the file: this module's
    // own comment explains the rule and names it.
    const source = read("src", "app", "(app)", "tenders", "empty-tender.ts");
    const firstStatement = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("//"));
    expect(firstStatement).not.toMatch(/^["']use client["']/);
  });

  it("is what the create page imports, rather than the client module", () => {
    const page = read("src", "app", "(app)", "tenders", "new", "page.tsx");
    expect(page).toContain('from "@/app/(app)/tenders/empty-tender"');
    expect(page).not.toContain('EMPTY_TENDER } from "@/app/(app)/tenders/tender-fields"');
  });

  it("carries every field the form needs, with the lists present", () => {
    // Each of these is walked by a child editor the moment it renders, so a
    // missing one is a blank page rather than a blank field.
    for (const key of ["positions", "required_roles", "required_skills", "required_certifications", "sectors"] as const) {
      expect(Array.isArray(EMPTY_TENDER[key]), key).toBe(true);
      expect(EMPTY_TENDER[key]).toHaveLength(0);
    }
    expect(EMPTY_TENDER.title).toBe("");
    expect(EMPTY_TENDER.status).toBe("draft");
    expect(EMPTY_TENDER.department_id).toBeNull();
    expect(Object.keys(EMPTY_TENDER)).toHaveLength(20);
  });
});
