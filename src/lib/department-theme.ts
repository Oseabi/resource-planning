/**
 * A department's colour, turned into the app's colour tokens.
 *
 * The corporate site gives each business unit one accent: maroon for
 * Consulting, green for Resourcing, amber for Construction, orange for
 * Human Capital. The app wears that accent, but not as printed: green,
 * amber and orange sit at about 2.5:1 on white, and text or a button in
 * them cannot be read all day. So the hex is used as it is where contrast
 * does not apply (a dot, a chip, the wash behind the active nav item, the
 * rules on a CV) and darkened along its own hue until it clears 4.5:1 for
 * everything that carries words. Dark mode lightens it the other way, to
 * the 7:1 the app's pale blue sits at today, and puts navy on it.
 *
 * Pure, no I/O. The result is a handful of CSS custom properties; the
 * layout writes them into a style block that outranks the defaults.
 */

/** The group, for an admin looking at no department in particular: the site's teal. */
export const GROUP_BRAND = { name: "TiPP Focus", colour: "#01789D" } as const;
/** The site's navy, which reads on every light tint. */
export const DARK_TEXT = "#1B2530";
/** The dark-mode card, which is what a dark-mode accent has to read on. */
export const DARK_CARD = "#283044";
const WHITE = "#FFFFFF";
const BLACK = "#000000";

/** The tokens a department changes. Everything else stays the app's own. */
export type ThemeToken =
  | "primary"
  | "primary-foreground"
  | "ring"
  | "chart-1"
  | "sidebar-primary"
  | "sidebar-primary-foreground"
  | "sidebar-accent"
  | "sidebar-accent-foreground"
  | "sidebar-ring";

export type ThemeTokens = Record<ThemeToken, string>;

export interface DepartmentTheme {
  light: ThemeTokens;
  dark: ThemeTokens;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

function rgb(hex: string): [number, number, number] {
  if (!isHexColour(hex)) throw new Error(`Not a colour: ${String(hex)}`);
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function hex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** WCAG relative luminance, 0 for black and 1 for white. */
export function relativeLuminance(colour: string): number {
  const [r, g, b] = rgb(colour).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/** A straight-line blend in sRGB: t = 0 is `from`, t = 1 is `to`. */
export function mix(from: string, to: string, t: number): string {
  const a = rgb(from);
  const b = rgb(to);
  return hex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/**
 * The colour moved toward black or white, in steps of a hundredth, until it
 * clears the ratio against the background. A colour that already clears it
 * comes back as it is, so maroon and teal are printed exactly.
 */
export function toContrast(colour: string, against: string, ratio: number, toward: string): string {
  for (let step = 0; step <= 100; step += 1) {
    const candidate = mix(colour, toward, step / 100);
    if (contrastRatio(candidate, against) >= ratio) return candidate;
  }
  return toward;
}

/** White where it reads on the colour, the site's navy where it does not. */
export function foregroundFor(background: string): string {
  return contrastRatio(WHITE, background) >= 4.5 ? WHITE : DARK_TEXT;
}

export function departmentTheme(colour: string): DepartmentTheme {
  const lightPrimary = toContrast(colour, WHITE, 4.5, BLACK);
  const darkPrimary = toContrast(colour, DARK_CARD, 7, WHITE);
  // The exact accent, washed to a tenth: the tint behind the active nav
  // item. The words on it need their own shade, since the wash is not white.
  const wash = mix(colour, WHITE, 0.9);
  return {
    light: {
      primary: lightPrimary,
      "primary-foreground": foregroundFor(lightPrimary),
      ring: lightPrimary,
      "chart-1": lightPrimary,
      "sidebar-primary": lightPrimary,
      "sidebar-primary-foreground": foregroundFor(lightPrimary),
      "sidebar-accent": wash,
      "sidebar-accent-foreground": toContrast(colour, wash, 4.5, BLACK),
      "sidebar-ring": lightPrimary,
    },
    dark: {
      primary: darkPrimary,
      "primary-foreground": DARK_TEXT,
      ring: darkPrimary,
      "chart-1": darkPrimary,
      "sidebar-primary": darkPrimary,
      "sidebar-primary-foreground": DARK_TEXT,
      "sidebar-accent": "#334155",
      "sidebar-accent-foreground": darkPrimary,
      "sidebar-ring": darkPrimary,
    },
  };
}

/**
 * The theme as a stylesheet. Two rules on the root element, one per mode,
 * each more specific than the defaults in globals.css so they win without
 * touching anything else. The text is only hex digits, token names and
 * punctuation, so it can be a plain string child of a style element.
 */
export function themeCss(theme: DepartmentTheme): string {
  const block = (tokens: ThemeTokens) =>
    (Object.keys(tokens) as ThemeToken[]).map((k) => `--${k}:${tokens[k]}`).join(";");
  return `:root:not(.dark){${block(theme.light)}}:root.dark{${block(theme.dark)}}`;
}
