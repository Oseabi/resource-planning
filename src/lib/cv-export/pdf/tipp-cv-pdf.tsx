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

const s = StyleSheet.create({
  page: {
    paddingTop: 72,
    paddingBottom: 60,
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
    const flat = [...source.technical_skills, ...source.skills];
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

/** The border styles for a cell at a given place in the grid. */
function edges(col: number, cols: number, last: boolean) {
  return [s.cell, ...(col === cols - 1 ? [s.lastCell] : []), ...(last ? [s.lastRow] : [])];
}

/** A cell's paragraphs: one line each, as the PROJECTS table lists its projects. */
type Cell = string | string[];

function TableRow({ cells, widths, last }: { cells: Cell[]; widths: number[]; last: boolean }) {
  const cols = widths.length;
  return (
    <View style={s.row} wrap={false}>
      {cells.map((c, i) => (
        <View key={i} style={[...edges(i, cols, last), { width: widths[i] }]}>
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
 * first row are one unbreakable piece, so a page never ends on a heading
 * with an empty table under it, nor on a column header with no row.
 */
function Table({ title, widths, header, rows }: { title: string; widths: number[]; header: string[]; rows: Cell[][] }) {
  const cols = widths.length;
  const [first, ...rest] = rows;
  return (
    <View style={s.table}>
      <View wrap={false}>
        <Section title={title} keepWithNext={false} />
        <View style={s.row} wrap={false}>
          {header.map((h, i) => (
            <View key={i} style={[...edges(i, cols, rows.length === 0), s.columnHeader, { width: widths[i] }]}>
              <Text>{h}</Text>
            </View>
          ))}
        </View>
        {first && <TableRow cells={first} widths={widths} last={rest.length === 0} />}
      </View>
      {rest.map((cells, r) => (
        <TableRow key={r} cells={cells} widths={widths} last={r === rest.length - 1} />
      ))}
    </View>
  );
}

/** A duties cell or an achievements box: sub-headings bold, bullets indented. */
function Lines({ text }: { text: string | null | undefined }) {
  return (
    <>
      {lineKinds(text).map((line, i) =>
        line.kind === "heading" ? (
          <Text key={i} style={[s.subHeading, i > 0 ? { marginTop: 8 } : {}]}>
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

function CvDocument({ source, context }: { source: CvSource; context: CvPdfContext }) {
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
    <Document title="Candidate Resume" author={context.generatedBy} creator="TiPP Focus Resource Planning">
      <Page size="A4" style={s.page}>
        <Header />
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
        <View style={s.box}>
          {summary.map((p, i) => (
            <Text key={i} style={s.paragraph}>
              {p}
            </Text>
          ))}
        </View>

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
            <View style={s.box}>
              <Lines text={achievements} />
            </View>
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
              <View style={[s.cell, s.lastCell, s.lastRow, { width: CONTENT_WIDTH }]}>
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

/** The candidate as a TiPP Focus CV, as PDF bytes. */
export async function renderTippCvPdf(source: CvSource, context: CvPdfContext): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<CvDocument source={source} context={context} />);
}
