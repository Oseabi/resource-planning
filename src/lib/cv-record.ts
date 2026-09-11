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

import type { SkillCategory, Certificate } from "@/lib/supabase/database.types";

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
