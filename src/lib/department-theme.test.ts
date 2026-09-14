import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  contrastRatio,
  departmentTheme,
  foregroundFor,
  isHexColour,
  mix,
  themeCss,
  toContrast,
  DARK_CARD,
  DARK_TEXT,
  GROUP_BRAND,
  type ThemeToken,
} from "@/lib/department-theme";

/** The four accents as the corporate site prints them, and the group's teal. */
const SEEDS = { consulting: "#68252C", resourcing: "#2CB673", construction: "#DC9204", "human-capital": "#F29101", group: GROUP_BRAND.colour };

describe("contrastRatio", () => {
  it("is the WCAG ratio", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    // The app's old blue on white, a figure the WCAG calculators agree on.
    expect(contrastRatio("#004ac6", "#FFFFFF")).toBeCloseTo(7.5, 0);
  });

  it("refuses anything that is not a colour", () => {
    expect(() => contrastRatio("blue", "#FFFFFF")).toThrow(/Not a colour/);
    expect(isHexColour("#ABCDEF")).toBe(true);
    expect(isHexColour("#ABCDE")).toBe(false);
    expect(isHexColour("ABCDEF")).toBe(false);
  });
});

describe("foregroundFor", () => {
  it("puts white on the dark accents and navy on the light ones", () => {
    expect(foregroundFor("#68252C")).toBe("#FFFFFF");
    expect(foregroundFor("#01789D")).toBe("#FFFFFF");
    for (const light of ["#DC9204", "#F29101", "#2CB673"]) expect(foregroundFor(light)).toBe(DARK_TEXT);
  });
});

describe("toContrast", () => {
  it("leaves a colour that already reads alone, and darkens one that does not along its own hue", () => {
    expect(toContrast("#68252C", "#FFFFFF", 4.5, "#000000")).toBe("#68252C");
    const green = toContrast("#2CB673", "#FFFFFF", 4.5, "#000000");
    expect(contrastRatio(green, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    // Darker, still green: the channels keep their order.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(green.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(r);
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });
});

describe("departmentTheme", () => {
  it("clears 4.5:1 on white in light mode and 7:1 on the dark card in dark mode, for every seed", () => {
    for (const colour of Object.values(SEEDS)) {
      const t = departmentTheme(colour);
      expect(contrastRatio(t.light.primary, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      expect(t.light["primary-foreground"]).toBe("#FFFFFF");
      expect(contrastRatio(t.dark.primary, DARK_CARD)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(DARK_TEXT, t.dark.primary)).toBeGreaterThanOrEqual(4.5);
      expect(t.dark["primary-foreground"]).toBe(DARK_TEXT);
    }
  });

  it("prints maroon and teal exactly, since they read as they are", () => {
    expect(departmentTheme("#68252C").light.primary).toBe("#68252C");
    expect(departmentTheme(GROUP_BRAND.colour).light.primary).toBe(GROUP_BRAND.colour);
  });

  it("washes the exact accent behind the active nav item", () => {
    const t = departmentTheme("#DC9204");
    expect(t.light["sidebar-accent"]).toBe(mix("#DC9204", "#FFFFFF", 0.9));
    expect(contrastRatio(t.light["sidebar-accent-foreground"], t.light["sidebar-accent"])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("themeCss", () => {
  it("writes one rule per mode with the same tokens, in characters a style element can hold as text", () => {
    const css = themeCss(departmentTheme("#2CB673"));
    expect(css).toMatch(/^:root:not\(\.dark\)\{[^}]+\}:root\.dark\{[^}]+\}$/);
    expect(css).toMatch(/^[a-z0-9#:;{}().,-]+$/i);
    const tokens = (block: string) => block.match(/--[a-z0-9-]+(?=:)/g) ?? [];
    const [light, dark] = css.split("}:root.dark{");
    expect(tokens(light)).toEqual(tokens(dark));
    expect(tokens(light)).toContain("--primary");
    expect(tokens(light)).toContain("--sidebar-ring");
  });
});

describe("globals.css", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css.slice(start, css.indexOf("}", start));
  };
  const token = (block: string, name: ThemeToken) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1].toUpperCase();

  it("carries the group theme, so the sign-in pages and an admin with no lens wear the same colours", () => {
    const group = departmentTheme(GROUP_BRAND.colour);
    for (const name of Object.keys(group.light) as ThemeToken[]) {
      expect(token(block(":root"), name), `:root --${name}`).toBe(group.light[name]);
      expect(token(block(".dark"), name), `.dark --${name}`).toBe(group.dark[name]);
    }
  });
});
