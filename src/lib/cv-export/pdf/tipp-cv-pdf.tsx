import fs from "node:fs";
import path from "node:path";
import React from "react";
import { Document, Page, View, Text, Image, Font, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { CvSource } from "@/lib/cv-export/missing-fields";
import { durationOf, lineKinds } from "@/lib/cv-record";
import { formatLongDate, parseLongDate } from "@/lib/dates";
import type { AccountManager } from "@/lib/supabase/database.types";

/**
 * The TiPP Focus CV as a PDF, drawn to match the ones the team issues.
 *
 * Everything here was measured off eight issued CVs rendered to pixels: the
 * header logo and tagline and where they sit, the cover page with its rules
 * and grey small print, the header table without inner rules, the section
 * headings over a 2pt teal rule, the shaded column headers, the bordered
 * boxes, the label column of the employment blocks, the bullet indent. The
 * fonts are the issued document's Century Gothic and Arial Bold when those
 * files are in fonts/overrides, and the open TeX Gyre Adventor and Liberation
 * Sans otherwise, which are the closest free faces and metrically near.
 *
 * Drawn rather than converted from the Word template because there is no
 * Word on the server, and a PDF that looks like the issued document is what
 * goes to a client. The Word template stays as a second output for anyone
 * who wants to edit.
 *
 * This folder is ESM (see package.json beside it) so the scripts that drive
 * the round trip can load it under tsx; Next and vitest do not care.
 */

export interface CvPdfContext {
  manager: AccountManager;
  /** Printed as the cover's "As of date". */
  asOf: Date;
  /** Written into the file's properties as its author. */
  generatedBy: string;
}

// ---------------------------------------------------------------------------
// Fonts and images
// ---------------------------------------------------------------------------

/**
 * Every file read below spells its folder out inside the call, because the
 * build traces these calls to decide which files ship with the route: a
 * folder named in place ships that folder, a path passed in from a variable
 * makes it ship the whole project.
 */
function readOverrideFont(name: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), "src", "lib", "cv-export", "fonts", "overrides", `${name}.ttf`));
  } catch {
    try {
      return fs.readFileSync(path.join(process.cwd(), "src", "lib", "cv-export", "fonts", "overrides", `${name}.otf`));
    } catch {
      return null;
    }
  }
}

/**
 * The issued document's own faces when their files have been dropped into
 * fonts/overrides (gothic-regular, gothic-bold, gothic-italic, label-bold,
 * as .ttf or .otf), else the free faces committed beside them.
 */
function fontData(name: string, bundled: string): { data: Buffer; mime: string } {
  const override = readOverrideFont(name);
  if (override) return { data: override, mime: "font/ttf" };
  return {
    data: fs.readFileSync(path.join(process.cwd(), "src", "lib", "cv-export", "fonts", bundled)),
    mime: bundled.endsWith(".otf") ? "font/otf" : "font/ttf",
  };
}

/** As a data URL: a Windows path reads as a URL to the loader and is fetched, and fails. */
function fontSrc(name: string, bundled: string): string {
  const { data, mime } = fontData(name, bundled);
  return `data:${mime};base64,${data.toString("base64")}`;
}

let fontsRegistered = false;
function registerFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  Font.register({
    family: "Gothic",
    fonts: [
      { src: fontSrc("gothic-regular", "gothic-regular.otf") },
      { src: fontSrc("gothic-bold", "gothic-bold.otf"), fontWeight: "bold" },
      { src: fontSrc("gothic-italic", "gothic-italic.otf"), fontStyle: "italic" },
    ],
  });
  Font.register({ family: "Label", fonts: [{ src: fontSrc("label-bold", "label-bold.ttf"), fontWeight: "bold" }] });
  // Word does not hyphenate these documents, so neither does this.
  Font.registerHyphenationCallback((word) => [word]);
}

const image = (file: string) => ({
  data: fs.readFileSync(path.join(process.cwd(), "src", "lib", "cv-export", "assets", file)),
  format: "png" as const,
});

// ---------------------------------------------------------------------------
// Geometry, in points, from the issued CVs
// ---------------------------------------------------------------------------

const RULE = "#0F4761";
const SHADE = "#E8E8E8";
const GREY = "#808080";
const CONTENT_WIDTH = 451;
/** The header table's label column, and the employment block's. */
const LABEL_COLUMN = 192;
const EMPLOYMENT_LABEL_COLUMN = 157;
/** Three-column tables: company / position / duration and the like. */
const COLUMNS_3 = [157, 176, 118];

/** Where the page's content starts and stops, below the header and above the foot. */
const PAGE_TOP = 80;
const PAGE_BOTTOM = 60;
/** A box or row that carries on from the page before gets its edge drawn this far above its first line. */
const CONTINUATION_GAP = 4;

const s = StyleSheet.create({
  page: {
    paddingTop: PAGE_TOP,
    paddingBottom: PAGE_BOTTOM,
    paddingLeft: 72,
    paddingRight: 72,
    fontFamily: "Gothic",
    fontSize: 9,
    lineHeight: 11 / 9,
    color: "#000000",
  },
  header: { position: "absolute", top: 0, left: 0, right: 0, height: 72 },
  headerLogo: { position: "absolute", left: 47, top: 14, width: 155, height: 45.5 },
  headerTagline: { position: "absolute", left: 340, top: 7, width: 212, height: 72.3 },

  // The cover
  // The issued cover draws its logo wider than the image's own proportions.
  coverLogo: { width: 254, height: 91, marginLeft: 105, marginTop: -3 },
  coverRule: { height: 0.75, backgroundColor: "#000000", marginTop: 46 },
  coverTitle: { fontFamily: "Gothic", fontWeight: "bold", fontSize: 12, textAlign: "center", marginTop: 40 },
  coverName: { fontFamily: "Gothic", fontWeight: "bold", fontSize: 16, textAlign: "center", marginTop: 46 },
  coverPosition: { fontFamily: "Gothic", fontWeight: "bold", fontSize: 16, textAlign: "center", marginTop: 18 },
  coverRuleAfter: { height: 0.75, backgroundColor: "#000000", marginTop: 16 },
  coverDetails: { marginTop: 24, color: GREY },
  coverLine: { flexDirection: "row" },
  coverLabel: { width: 115 },
  coverSmall: { fontStyle: "italic", fontSize: 8, color: GREY, lineHeight: 10 / 8 },
  coverItem: { flexDirection: "row" },
  coverNumeral: { width: 18, textAlign: "right", marginLeft: -12, marginRight: 12 },

  // Sections
  heading: {
    fontFamily: "Label",
    fontWeight: "bold",
    fontSize: 12,
    lineHeight: 1.2,
    textAlign: "center",
    marginTop: 26,
    marginBottom: 20,
  },
  rule: { height: 2, backgroundColor: RULE, marginBottom: 24 },
  box: { borderWidth: 0.75, borderColor: "#000000", paddingVertical: 6, paddingHorizontal: 6 },
  paragraph: { textAlign: "justify" },

  // Tables. Every cell draws its own top and left edge, the last cell in a
  // row its right edge and the last row its bottom edge, so a row that moves
  // to the next page takes its lines with it and leaves nothing behind.
  table: {},
  row: { flexDirection: "row" },
  cell: { borderTopWidth: 0.75, borderLeftWidth: 0.75, borderColor: "#000000", paddingHorizontal: 6, paddingVertical: 4 },
  lastCell: { borderRightWidth: 0.75 },
  lastRow: { borderBottomWidth: 0.75 },
  columnHeader: { fontFamily: "Label", fontWeight: "bold", fontSize: 11, lineHeight: 1.2, backgroundColor: SHADE, paddingVertical: 6 },
  label: { fontFamily: "Label", fontWeight: "bold", fontSize: 12, lineHeight: 1.2 },
  headerCell: { borderRightWidth: 0.75, borderColor: "#000000", paddingHorizontal: 6, paddingVertical: 4, justifyContent: "center" },
  employmentLabel: { fontFamily: "Label", fontWeight: "bold", fontSize: 11, lineHeight: 1.2, backgroundColor: SHADE },
  employmentValue: { fontFamily: "Gothic", fontWeight: "bold" },

  // Lists inside a cell: a bold line for a sub-heading, an indented bullet otherwise
  subHeading: { fontFamily: "Gothic", fontWeight: "bold" },
  bulletRow: { flexDirection: "row", paddingLeft: 18 },
  cellBulletRow: { flexDirection: "row" },
  bulletGlyph: { width: 18 },
  bulletText: { flex: 1, textAlign: "justify" },
});

// ---------------------------------------------------------------------------
// The data, as the pages print it
// ---------------------------------------------------------------------------

const AVAILABILITY_TEXT: Record<string, string> = {
  available: "Immediately Available",
  notice_period: "On notice",
  unavailable: "Not currently available",
};

/** "14+ years" as the template writes it, from a number. */
function yearsText(years: number | null | undefined): string {
  if (years == null || !Number.isFinite(years) || years <= 0) return "";
  const whole = Math.floor(years);
  return `${whole}${years > whole ? "+" : ""} year${whole === 1 ? "" : "s"}`;
}

/** A SKILLSET row: years once for the row when every skill agrees, else beside each. */
function skillsetRows(source: CvSource): { category: string; skills: string; years: string }[] {
  const matrix = source.skill_matrix ?? [];
  if (matrix.length === 0) {
    // A record read off the older template keeps the bullet its skills cell
    // was typed with; printed joined with semicolons, the bullets have to go.
    const flat = [...source.technical_skills, ...source.skills]
      .map((sk) => sk.replace(/^[\s•▪●◦‣∙·*-]+/, "").replace(/[\s;,]+$/, "").trim())
      .filter(Boolean);
    return flat.length ? [{ category: "Skills", skills: flat.join("; "), years: "" }] : [];
  }
  return matrix.map((row) => {
    const years = new Set(row.skills.map((sk) => sk.years?.trim() || ""));
    const shared = years.size === 1 ? [...years][0] : null;
    return {
      category: row.category,
      skills: row.skills
        .map((sk) => (shared === null && sk.years?.trim() ? `${sk.name} (${sk.years.trim()})` : sk.name))
        .join("; "),
      years: shared ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

// react-pdf's Image is not an <img>: the a11y rule below does not apply to it.
/* eslint-disable jsx-a11y/alt-text */

function Header() {
  return (
    <View style={s.header} fixed>
      <Image style={s.headerLogo} src={image("logo-header.png")} />
      <Image style={s.headerTagline} src={image("tagline.png")} />
    </View>
  );
}

/**
 * A heading over its rule. Never split from each other, and never left at
 * the foot of a page with nothing under them: a table's heading travels
 * with the table's column header and first row, and a box's heading asks
 * for room enough for a few lines below it.
 */
function Section({ title, keepWithNext = true }: { title: string; keepWithNext?: boolean }) {
  return (
    <View wrap={false} minPresenceAhead={keepWithNext ? 60 : 0}>
      <Text style={s.heading}>{title}</Text>
      <View style={s.rule} />
    </View>
  );
}

/**
 * The border styles for a cell at a given place in the grid. A cell that
 * carries on a row from the slice above draws no top edge, so the slices
 * read as one cell.
 */
function edges(col: number, cols: number, last: boolean, continued: boolean, continues = false) {
  return [
    s.cell,
    // No edge and no padding at a join, so the slices read as one cell.
    ...(continued ? [{ borderTopWidth: 0, paddingTop: 0 }] : []),
    ...(continues ? [{ paddingBottom: 0 }] : []),
    ...(col === cols - 1 ? [s.lastCell] : []),
    ...(last ? [s.lastRow] : []),
  ];
}

/** A cell's paragraphs: one line each, as the PROJECTS table lists its projects. */
type Cell = string | string[];

// A table row is never split by the page breaker: a row is three cells side
// by side, and the breaker splits a row's cells one at a time, so the short
// ones stay behind and the tall one carries on alone at the left edge. A row
// too tall for the space is cut into slices here instead, at the joins of its
// text, each slice a row of its own that fits with room to spare and draws
// no line between itself and the one before.

/** Roughly how many characters of the body face fit on a line of a cell this wide. Low on purpose: a slice guessed too tall is the failure that matters. */
function charsPerLine(width: number): number {
  return Math.max(10, Math.floor((width - 12) / 4.6));
}

/** Lines a paragraph takes in a cell, by greedy word wrap at the average glyph width. */
function linesOf(text: string, width: number): number {
  const cap = charsPerLine(width);
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (used > 0 && used + 1 + word.length > cap) {
      lines += Math.max(1, Math.ceil(word.length / cap));
      used = word.length % cap;
    } else {
      used += (used > 0 ? 1 : 0) + word.length;
    }
  }
  return lines;
}

/**
 * The most lines a slice may hold, and the fewer the first slice of a row
 * that has to be cut may hold. The first travels with the heading and the
 * column header as one piece, and kept small that piece fits in what is
 * left of most pages rather than carrying the heading over and leaving a
 * quarter of a page blank. The joins between slices cost nothing to look
 * at, so a row that fits whole is never cut.
 */
const MAX_SLICE_LINES = 10;
const FIRST_SLICE_LINES = 4;

/** How many lines the k-th piece of a cut row may hold. */
const cap = (k: number) => (k === 0 ? FIRST_SLICE_LINES : MAX_SLICE_LINES);

/** A paragraph cut at its joins into pieces: at "; " first, then at sentence ends, then anywhere. */
function paragraphPieces(text: string, width: number): string[] {
  if (linesOf(text, width) <= MAX_SLICE_LINES) return [text];
  for (const joint of [/(?<=;)\s+/, /(?<=[.,])\s+/, /\s+/]) {
    const parts = text.split(joint).filter(Boolean);
    if (parts.length < 2) continue;
    const out: string[] = [];
    let current = "";
    for (const part of parts) {
      const joined = current ? `${current} ${part}` : part;
      if (current && linesOf(joined, width) > cap(out.length)) {
        out.push(current);
        current = part;
      } else {
        current = joined;
      }
    }
    if (current) out.push(current);
    if (out.every((piece, k) => linesOf(piece, width) <= cap(k))) return out;
  }
  return [text];
}

/** A list cut between its items into pieces. */
function listPieces(items: string[], width: number): string[][] {
  const total = items.reduce((sum, item) => sum + linesOf(item, width - 18), 0);
  if (total <= MAX_SLICE_LINES) return [items];
  const out: string[][] = [];
  let current: string[] = [];
  let lines = 0;
  for (const item of items) {
    const n = linesOf(item, width - 18);
    if (current.length > 0 && lines + n > cap(out.length)) {
      out.push(current);
      current = [];
      lines = 0;
    }
    current.push(item);
    lines += n;
  }
  if (current.length > 0) out.push(current);
  return out.length > 0 ? out : [[]];
}

/** A row as the slices it is drawn in: one for most rows, several for a row too tall to keep whole. */
function rowSlices(cells: Cell[], widths: number[]): Cell[][] {
  const perCell = cells.map((c, i) => (Array.isArray(c) ? listPieces(c, widths[i]) : paragraphPieces(c, widths[i])));
  const count = Math.max(1, ...perCell.map((p) => p.length));
  return Array.from({ length: count }, (_, k) => perCell.map((p, i) => p[k] ?? (Array.isArray(cells[i]) ? [] : "")));
}

function RowSlice({
  id,
  cells,
  widths,
  last,
  continued,
  continues,
}: {
  /** Names the slice for the guides: "row-" for a row's first slice, "row-continued-" for the rest. */
  id: string;
  cells: Cell[];
  widths: number[];
  last: boolean;
  continued: boolean;
  continues: boolean;
}) {
  const cols = widths.length;
  return (
    <View style={s.row} wrap={false} id={id}>
      {cells.map((c, i) => (
        <View key={i} style={[...edges(i, cols, last, continued, continues), { width: widths[i] }]}>
          {Array.isArray(c) ? (
            // A list in a cell is bulleted, as the PROJECTS table is on the issued CVs.
            c.map((item, j) => (
              <View key={j} style={s.cellBulletRow} wrap={false}>
                <Text style={s.bulletGlyph}>{"•"}</Text>
                <Text style={{ flex: 1 }}>{item}</Text>
              </View>
            ))
          ) : (
            <Text>{c}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

/**
 * A section heading with its table. The heading, the column header and the
 * first slice of the first row are one unbreakable piece, so a page never
 * ends on a heading with an empty table under it, nor on a column header
 * with no row.
 */
function Table({ title, widths, header, rows }: { title: string; widths: number[]; header: string[]; rows: Cell[][] }) {
  const cols = widths.length;
  const name = title.toLowerCase().replace(/[^a-z]+/g, "-");
  const slices = rows.flatMap((cells, r) =>
    rowSlices(cells, widths).map((slice, k, all) => ({
      id: `${k > 0 ? "row-continued" : "row"}-${name}-${r}-${k}`,
      cells: slice,
      continued: k > 0,
      continues: k < all.length - 1,
      last: r === rows.length - 1 && k === all.length - 1,
    })),
  );
  const [first, ...rest] = slices;
  return (
    <View style={s.table}>
      <View wrap={false}>
        <Section title={title} keepWithNext={false} />
        <View style={s.row} wrap={false}>
          {header.map((h, i) => (
            <View key={i} style={[...edges(i, cols, slices.length === 0, false), s.columnHeader, { width: widths[i] }]}>
              <Text>{h}</Text>
            </View>
          ))}
        </View>
        {first && <RowSlice {...first} widths={widths} />}
      </View>
      {rest.map((slice, r) => (
        <RowSlice key={r} {...slice} widths={widths} />
      ))}
    </View>
  );
}

/** A bordered box that may run over a page: the page breaker splits it, and the guides close the two halves. */
function Box({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <View style={s.box} id={`box-${id}`}>
      {children}
    </View>
  );
}

/** A duties cell or an achievements box: sub-headings bold, bullets indented. */
function Lines({ text }: { text: string | null | undefined }) {
  return (
    <>
      {lineKinds(text).map((line, i) =>
        line.kind === "heading" ? (
          // Never the last line on a page: it asks for room for two bullets under it.
          <Text key={i} style={[s.subHeading, i > 0 ? { marginTop: 8 } : {}]} minPresenceAhead={24}>
            {line.text}
          </Text>
        ) : (
          <View key={i} style={s.bulletRow} wrap={false}>
            <Text style={s.bulletGlyph}>{"•"}</Text>
            <Text style={s.bulletText}>{line.text}</Text>
          </View>
        ),
      )}
    </>
  );
}

function Cover({ source, context }: { source: CvSource; context: CvPdfContext }) {
  const conditions = [
    "That the Client does not divulge it to anyone without the Candidate’s written consent,",
    "That the Client will not engage directly with the Candidate without Tipp Focus’s prior written consent,",
    "That no contact whatsoever shall be made with the Candidate’s present employer without the Candidate’s express consent,",
    "That no references shall be taken on the Candidate without the prior permission of the Candidate or Tipp Focus and",
    "That no offer of permanent employment is made to the candidate without Tipp Focus’s prior express consent.",
  ];
  const numerals = ["i.", "ii.", "iii.", "iv.", "v."];
  return (
    <View break={false}>
      <Image style={s.coverLogo} src={image("logo-cover.png")} />
      <View style={s.coverRule} />
      <Text style={s.coverTitle}>Candidate Resume</Text>
      <Text style={s.coverName}>{source.full_name}</Text>
      <Text style={s.coverPosition}>{source.current_role ?? ""}</Text>
      <View style={s.coverRuleAfter} />
      <View style={s.coverDetails}>
        {[
          ["As of date:", formatLongDate(context.asOf.toISOString().slice(0, 10)) ?? ""],
          ["Account Manager:", context.manager.name],
          ["Email address:", context.manager.email],
          ["Office Contact Details:", context.manager.phone],
        ].map(([label, value]) => (
          <View key={label} style={s.coverLine}>
            <Text style={s.coverLabel}>{label}</Text>
            <Text>{value}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 26 }}>
        <Text style={s.coverSmall}>
          All information concerning the resource is furnished to the Client in strict confidence and on condition:
        </Text>
        <View style={{ marginTop: 8 }}>
          {conditions.map((c, i) => (
            <View key={i} style={[s.coverItem, s.coverSmall]}>
              <Text style={[s.coverSmall, s.coverNumeral]}>{numerals[i]}</Text>
              <Text style={[s.coverSmall, { flex: 1, textAlign: "justify" }]}>{c}</Text>
            </View>
          ))}
        </View>
        <Text style={[s.coverSmall, { marginTop: 18 }]}>Protection of Personal Information (POPI) compliance:</Text>
        <Text style={[s.coverSmall, { marginTop: 10, textAlign: "justify" }]}>
          The information contained in this document has been submitted to you with the Candidate’s express
          permission for the specific purpose of marketing the candidate to your company. Your consideration of
          the candidate for employment opportunities will be appreciated.
        </Text>
        <Text style={[s.coverSmall, { marginTop: 10, textAlign: "justify" }]}>
          In accordance with the Protection of Personal Information Act, you may only use this information for
          the purpose mentioned and should discard/destroy this information after the purpose for which it has
          been submitted has been completed. As we are under a similar obligation, your response to this
          application will be appreciated so that we can inform the candidate and act in accordance with POPI.
        </Text>
      </View>
    </View>
  );
}

/** A line to draw on one page: where a box or a row that the page breaker cut is closed off. */
interface Guide {
  top: number;
  left: number;
  width: number;
}

/** What the page breaker made of the document, as react-pdf reports it after rendering. */
interface LayoutNode {
  type?: string;
  box?: { top?: number; left?: number; width?: number; height?: number };
  style?: { borderTopWidth?: number; borderBottomWidth?: number };
  props?: { id?: string; fixed?: boolean };
  children?: LayoutNode[];
}

/** The nodes in the flow, without the header and the guides, which sit on every page. */
const flow = (node: LayoutNode): LayoutNode[] => (node.children ?? []).filter((c) => !c.props?.fixed);

/**
 * The chain from a page down its first (or last) child in the flow, each
 * with its position on the page. Child boxes are placed relative to their
 * parent, so the tops are summed on the way down.
 */
function chain(page: LayoutNode, side: "first" | "last"): { node: LayoutNode; top: number; left: number }[] {
  const out: { node: LayoutNode; top: number; left: number }[] = [];
  let node: LayoutNode | undefined = page;
  let top = 0;
  let left = 0;
  while (node) {
    const kids = flow(node);
    const next: LayoutNode | undefined = side === "first" ? kids[0] : kids[kids.length - 1];
    if (!next) break;
    top += next.box?.top ?? 0;
    left += next.box?.left ?? 0;
    out.push({ node: next, top, left });
    node = next;
  }
  return out;
}

const isBox = (n: LayoutNode) => /^box-/.test(n.props?.id ?? "");
const isRow = (n: LayoutNode) => /^row(-continued)?-/.test(n.props?.id ?? "");
const isContinuedRow = (n: LayoutNode) => /^row-continued-/.test(n.props?.id ?? "");

/**
 * Where the page breaker cut a box or a row, and what to draw to close it.
 *
 * react-pdf splits a bordered box at the foot of a page by taking the bottom
 * edge off the first half and the top edge off the second, so the box runs
 * off one page and starts the next with no line at all, and the same happens
 * between a row and the slice that continues it. Word closes a cell on both
 * sides of the break, which is what the issued CVs look like. This reads the
 * rendered layout, finds the halves at the top and foot of each page, and
 * hands back the lines that close them; the second render draws those lines
 * as fixed marks that take no room, so the pages break exactly as before.
 */
function guidesFor(layout: LayoutNode): Map<number, Guide[]> {
  const pages = layout.children ?? [];
  const guides = new Map<number, Guide[]>();
  const add = (page: number, guide: Guide) => guides.set(page, [...(guides.get(page) ?? []), guide]);

  pages.forEach((page, i) => {
    const number = i + 1;
    // A box cut at the top of this page: close it above its first line.
    for (const { node, top, left } of chain(page, "first")) {
      const cut = isBox(node) && node.style?.borderTopWidth === 0;
      if (cut || isContinuedRow(node)) {
        add(number, { top: top - CONTINUATION_GAP, left, width: node.box?.width ?? 0 });
        break;
      }
    }
    // A box cut at the foot: close it where the page's content stops. A row
    // whose next slice opens the following page is closed the same way.
    const nextOpensWithRow = pages[i + 1] ? chain(pages[i + 1], "first").some(isContinuedRowEntry) : false;
    for (const { node, top, left } of chain(page, "last")) {
      const cut = isBox(node) && node.style?.borderBottomWidth === 0;
      if (cut || (isRow(node) && nextOpensWithRow)) {
        add(number, { top: top + (node.box?.height ?? 0), left, width: node.box?.width ?? 0 });
        break;
      }
    }
  });
  return guides;
}

const isContinuedRowEntry = (entry: { node: LayoutNode }) => isContinuedRow(entry.node);

function Guides({ guides }: { guides: Map<number, Guide[]> }) {
  return (
    <View
      fixed
      style={{ position: "absolute", top: 0, left: 0, width: 595.28, height: 841.89 }}
      render={({ pageNumber }: { pageNumber: number }) => (
        <>
          {(guides.get(pageNumber) ?? []).map((g, i) => (
            <View key={i} style={{ position: "absolute", top: g.top, left: g.left, width: g.width, height: 0.75, backgroundColor: "#000000" }} />
          ))}
        </>
      )}
    />
  );
}

function CvDocument({
  source,
  context,
  guides,
  onLayout,
}: {
  source: CvSource;
  context: CvPdfContext;
  guides?: Map<number, Guide[]>;
  onLayout?: (layout: LayoutNode) => void;
}) {
  const dob = source.date_of_birth?.trim() ?? "";
  const headerRows: [string, string][] = [
    ["FULL NAME (S)", source.full_name ?? ""],
    ["DATE OF BIRTH", formatLongDate(parseLongDate(dob)) ?? dob],
    ["POSITION", source.current_role ?? ""],
    ["DESIGNATED GROUP", source.designated_group ?? ""],
    ["YEARS OF EXPERIENCE", yearsText(source.years_experience)],
    [
      "AVAILABILITY",
      source.availability_note?.trim() ||
        (source.availability ? (AVAILABILITY_TEXT[source.availability] ?? source.availability) : ""),
    ],
  ];

  const summary = (source.professional_summary ?? "")
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const career = source.work_experience.map((e) => [e.company ?? "", e.title ?? "", durationOf(e)]);
  const education = source.education.length
    ? source.education.map((e) => [e.qualification, e.institution ?? "", e.year ?? ""])
    : source.qualifications.map((q) => [q, "", ""]);
  const certificates = (source.certificates ?? []).length
    ? (source.certificates ?? []).map((c) => [c.name, c.institution ?? "", c.year ?? ""])
    : source.certifications.map((c) => [c, "", ""]);
  const skillset = skillsetRows(source).map((r) => [r.category, r.skills, r.years]);
  const projects = (source.projects ?? [])
    .filter((g) => g.company.trim() || g.projects.length)
    .map((g): Cell[] => [g.company, g.projects]);
  const achievements = source.achievements?.trim() ?? "";

  return (
    <Document
      title="Candidate Resume"
      author={context.generatedBy}
      creator="TiPP Focus Resource Planning"
      // The layout comes back on a field the typings do not name. Pinned to
      // this version of react-pdf; the guides test catches a change.
      onRender={(result: unknown) => onLayout?.((result as { _INTERNAL__LAYOUT__DATA_?: LayoutNode })._INTERNAL__LAYOUT__DATA_ ?? {})}
    >
      <Page size="A4" style={s.page}>
        <Header />
        {guides && <Guides guides={guides} />}
        <Cover source={source} context={context} />

        {/* The header table: one box, a divider, no rules between rows. */}
        <View style={{ borderWidth: 0.75, borderColor: "#000000" }} break>
          {headerRows.map(([label, value]) => (
            <View key={label} style={[s.row, { minHeight: 24 }]} wrap={false}>
              <View style={[s.headerCell, { width: LABEL_COLUMN }]}>
                <Text style={s.label}>{label}</Text>
              </View>
              <View style={[s.headerCell, { flex: 1, borderRightWidth: 0 }]}>
                <Text>{value}</Text>
              </View>
            </View>
          ))}
        </View>

        <Section title="CANDIDATE OVERVIEW" />
        <Box id="overview">
          {summary.map((p, i) => (
            <Text key={i} style={s.paragraph}>
              {p}
            </Text>
          ))}
        </Box>

        <Table title="CAREER SUMMARY" widths={COLUMNS_3} header={["COMPANY", "POSITION", "DURATION"]} rows={career} />

        <Table title="QUALIFICATIONS" widths={COLUMNS_3} header={["QUALIFICATION", "INSTITUTION", "YEAR"]} rows={education} />

        {certificates.length > 0 && (
          <>
            <Table title="CERTIFICATES AND COURSES" widths={COLUMNS_3} header={["QUALIFICATION", "INSTITUTION", "YEAR"]} rows={certificates} />
          </>
        )}

        <Table title="SKILLSET" widths={COLUMNS_3} header={["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"]} rows={skillset} />

        {projects.length > 0 && (
          <>
            <Table title="PROJECTS" widths={[EMPLOYMENT_LABEL_COLUMN, CONTENT_WIDTH - EMPLOYMENT_LABEL_COLUMN]} header={["COMPANY NAME", "PROJECT NAME"]} rows={projects} />
          </>
        )}

        {achievements && (
          <>
            <Section title="ACHIEVEMENTS" />
            <Box id="achievements">
              <Lines text={achievements} />
            </Box>
          </>
        )}

        {source.work_experience.map((job, i) => {
          const client = job.client?.trim() || null;
          const labelled: [string, string][] = [
            ["Company", job.company ?? ""],
            ...(client ? ([["Client", client]] as [string, string][]) : []),
            ["Role", job.title ?? ""],
            ["Duration", durationOf(job)],
          ];
          return (
            <View key={i} style={{ marginBottom: i < source.work_experience.length - 1 ? 24 : 0 }}>
              {/* The label rows stay together, and the first block's with the heading. */}
              <View wrap={false}>
                {i === 0 && <Section title="EMPLOYMENT HISTORY" keepWithNext={false} />}
                {labelled.map(([label, value]) => (
                  <View key={label} style={s.row} wrap={false}>
                    <View style={[s.cell, s.employmentLabel, { width: EMPLOYMENT_LABEL_COLUMN }]}>
                      <Text>{label}</Text>
                    </View>
                    <View style={[s.cell, s.lastCell, { width: CONTENT_WIDTH - EMPLOYMENT_LABEL_COLUMN }]}>
                      <Text style={s.employmentValue}>{value}</Text>
                    </View>
                  </View>
                ))}
              </View>
              {/* A column, not a row, so a long list splits across pages. */}
              <View style={[s.cell, s.lastCell, s.lastRow, { width: CONTENT_WIDTH }]} id={`box-duties-${i}`}>
                <Text style={s.employmentValue}>Duties:</Text>
                <Lines text={job.description} />
              </View>
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

/**
 * The candidate as a TiPP Focus CV, as PDF bytes.
 *
 * Rendered twice: once to learn where the page breaker cut a box or a row,
 * and once more with the lines that close those cuts drawn in. The lines
 * are fixed marks outside the flow, so the second render breaks its pages
 * exactly where the first did.
 */
export async function renderTippCvPdf(source: CvSource, context: CvPdfContext): Promise<Buffer> {
  registerFonts();
  let layout: LayoutNode = {};
  await renderToBuffer(<CvDocument source={source} context={context} onLayout={(l) => (layout = l)} />);
  return renderToBuffer(<CvDocument source={source} context={context} guides={guidesFor(layout)} />);
}

/** For the tests: the lines the first render asks the second to draw. */
export async function cvPdfGuides(source: CvSource, context: CvPdfContext): Promise<Map<number, Guide[]>> {
  registerFonts();
  let layout: LayoutNode = {};
  await renderToBuffer(<CvDocument source={source} context={context} onLayout={(l) => (layout = l)} />);
  return guidesFor(layout);
}

