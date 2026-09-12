/**
 * Keeping a candidate's structured CV fields and flat lists in step.
 *
 * The record holds skills two ways: the SKILLSET table as it appears on the
 * template, and a flat list that matching scores and the filter searches.
 * Certificates likewise. The flat lists are derived from the tables on every
 * save, as a union with whatever is already there, so a skill typed straight
 * into the flat list survives and a skill added to the table reaches
 * matching without a second entry.
 *
 * Pure, no I/O.
 */

import type { SkillCategory, Certificate, Education } from "@/lib/supabase/database.types";

/**
 * The SKILLSET rows as the issued template prints them, in its order. Every
 * one of the eight real CVs read so far uses exactly these; the AI is asked
 * to sort a generic CV's skills into them so its CV comes out the same way.
 */
export const TEMPLATE_SKILL_CATEGORIES = [
  "Programming Languages",
  "Technologies",
  "Databases",
  "Frameworks",
  "Software Platforms",
  "Tools",
  "Methodologies",
  "Domain Knowledge",
] as const;

const fold = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

/** `existing` plus every name in `names`, first spelling wins, order kept. */
function union(existing: string[], names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...existing, ...names]) {
    const t = v.trim();
    if (!t) continue;
    const key = fold(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** The flat technical skills, with every skill in the matrix included. */
export function deriveTechnicalSkills(matrix: SkillCategory[], existing: string[]): string[] {
  return union(
    existing,
    matrix.flatMap((c) => c.skills.map((s) => s.name)),
  );
}

/** The flat certification names, with every detailed certificate included. */
export function deriveCertifications(certificates: Certificate[], existing: string[]): string[] {
  return union(
    existing,
    certificates.map((c) => c.name),
  );
}

/** The flat qualification names, with every education row included. */
export function deriveQualifications(education: Education[], existing: string[]): string[] {
  return union(
    existing,
    education.map((e) => e.qualification),
  );
}

/**
 * A duration as the template writes it: "October 2020 - Current". Shared by
 * the profile's career summary and the generated CV so the two agree.
 */
export function durationOf(entry: {
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
}): string {
  const start = entry.start_date?.trim();
  if (!start) return "";
  if (entry.is_current) return `${start} - Current`;
  const end = entry.end_date?.trim();
  return end ? `${start} - ${end}` : start;
}

/** Drop rows the form left blank, and blank skills inside a category. */
export function cleanSkillMatrix(matrix: SkillCategory[]): SkillCategory[] {
  return matrix
    .map((c) => ({
      category: c.category.trim(),
      skills: c.skills
        .map((s) => ({
          name: s.name.trim(),
          years: s.years?.trim() || null,
          note: s.note?.trim() || null,
        }))
        .filter((s) => s.name),
    }))
    .filter((c) => c.category || c.skills.length > 0)
    .map((c) => ({ ...c, category: c.category || "General" }));
}

export function cleanCertificates(certificates: Certificate[]): Certificate[] {
  return certificates
    .map((c) => ({
      name: c.name.trim(),
      institution: c.institution?.trim() || null,
      year: c.year?.trim() || null,
    }))
    .filter((c) => c.name);
}

type LineKind = "bullet" | "heading";

/**
 * The lines of a duties cell or an achievements box, each a bullet or a
 * sub-heading. The readers keep a bullet on every line that was one on the
 * CV, so a line without one is a sub-heading. Text from before the markers,
 * or from the AI, has none at all, and then every line is a bullet.
 */
export function lineKinds(text: string | null | undefined): { kind: LineKind; text: string }[] {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^client:/i.test(l));
  const marked = lines.some((l) => /^[•▪●]/.test(l));
  return lines.map((l) => {
    const bullet = /^[•▪●\-\*]\s*/.test(l);
    return { kind: !marked || bullet ? "bullet" : "heading", text: l.replace(/^[•▪●\-\*]\s*/, "") };
  });
}
