/**
 * Who in the pool answers a request, best first.
 *
 * Pure: the action reads the rows, this decides. The weights are the matching
 * engine's (role 35, skills 25, certificates 20, experience 10, availability
 * 10) so a person ranks here roughly as they would on a tender, but the
 * certificate and skill checks are holdsCertificate's, which know exam codes
 * and find a one-word certificate inside a longer entry.
 *
 * Two lists come back. `fits` meets everything that was asked; `close` makes
 * the answer up to the number asked for when not enough people do, each with
 * what they lack, because "nobody" is rarely the useful answer and a near
 * miss said plainly is.
 */
import { roleMatch, experienceMatch, availabilityMatch, SCORING_WEIGHTS, type Availability } from "@/lib/scoring";
import { holdsCertificate } from "@/lib/talent-search/certificates";
import type { TalentQuery } from "@/lib/talent-search/query";

export interface PoolCandidate {
  id: string;
  full_name: string;
  current_role: string | null;
  additional_roles: string[];
  skills: string[];
  technical_skills: string[];
  certifications: string[];
  years_experience: number | null;
  availability: Availability;
  status: "active" | "inactive" | "placed";
  location: string | null;
  /** Titles of certificate documents on the person's file. */
  certificateDocuments?: string[];
}

export interface TalentResult {
  id: string;
  name: string;
  role: string | null;
  /** The role that answered the request, when it is not the current one. */
  matchedRole: string | null;
  years: number | null;
  location: string | null;
  availability: Availability;
  score: number;
  /** Requested certificates held, with the person's own wording. */
  certificates: { wanted: string; via: string }[];
  skills: { wanted: string; via: string }[];
  /** Everything asked for that this person does not meet, in words. */
  missing: string[];
  /** Things that could not be checked, said but not held against them. */
  unchecked: string[];
}

export interface TalentAnswer {
  fits: TalentResult[];
  close: TalentResult[];
  /** How many in the pool meet everything, before cutting to the count. */
  fitCount: number;
  /** How many people were searched. */
  searched: number;
}

/**
 * Whether a person is the role asked for, and through which of their roles.
 *
 * The engine's fuzzy role score shares words, so "Specialist QA Engineer" is
 * half a "Data Engineer". That is fine for ordering a tender shortlist and
 * wrong for "give me data engineers", so a fit here needs every word of the
 * role (or the same role by alias). The one family widened on purpose is the
 * generic developer: a Java or C# developer is a software developer.
 */
const GENERIC_DEVELOPER = /^(software developer|software engineer|developer|programmer|software programmer)$/i;
const ANY_DEVELOPER = /(developer|programmer|software engineer)/i;
/** Half the words, the floor for being shown at all as a near miss. */
const ROLE_NEAR = 0.5;

export function roleFit(roles: (string | null)[], wanted: string): { fit: boolean; score: number; via: string | null } {
  let best = { fit: false, score: 0, via: null as string | null };
  for (const r of roles) {
    if (!r || !r.trim()) continue;
    const score = roleMatch(r, wanted);
    const fit = score >= 0.9 || (GENERIC_DEVELOPER.test(wanted.trim()) && ANY_DEVELOPER.test(r));
    const shown = fit ? Math.max(score, 0.9) : score;
    if ((fit && !best.fit) || (fit === best.fit && shown > best.score)) best = { fit, score: shown, via: r };
  }
  return best;
}

function locationMatches(candidate: string | null, wanted: string): boolean {
  if (!candidate) return false;
  const c = candidate.toLowerCase();
  const w = wanted.toLowerCase();
  if (c.includes(w)) return true;
  // A city's people count for its province and the other way round, for the
  // provinces this business mostly works in.
  const gauteng = ["johannesburg", "pretoria", "centurion", "midrand", "sandton", "randburg", "roodepoort", "soweto", "tshwane", "ekurhuleni", "gauteng"];
  if (w === "gauteng") return gauteng.some((g) => c.includes(g));
  if (w === "western cape") return ["cape town", "stellenbosch", "western cape"].some((g) => c.includes(g));
  if (w === "kwazulu-natal") return ["durban", "pietermaritzburg", "kwazulu", "kzn"].some((g) => c.includes(g));
  return false;
}

export function rankTalent(pool: PoolCandidate[], q: TalentQuery): TalentAnswer {
  const searched = pool.filter((c) => c.status === "active");
  const scored = searched.map((c) => {
    const role = q.role ? roleFit([c.current_role, ...(c.additional_roles ?? [])], q.role) : { fit: true, score: 1, via: null };
    const certEvidence = [...(c.certifications ?? []), ...(c.certificateDocuments ?? [])];
    const certificates: TalentResult["certificates"] = [];
    const missing: string[] = [];
    for (const wanted of q.certifications) {
      const hit = holdsCertificate(certEvidence, wanted);
      if (hit.held && hit.via) certificates.push({ wanted, via: hit.via });
      else missing.push(wanted);
    }
    const skillEvidence = [...(c.skills ?? []), ...(c.technical_skills ?? [])];
    const skills: TalentResult["skills"] = [];
    for (const wanted of q.skills) {
      const hit = holdsCertificate(skillEvidence, wanted);
      if (hit.held && hit.via) skills.push({ wanted, via: hit.via });
      else missing.push(wanted);
    }
    if (q.role && !role.fit) missing.unshift(`not a ${q.role} (${c.current_role ?? "no role on file"})`);
    if (q.minYears && (c.years_experience ?? 0) < q.minYears) {
      missing.push(`${c.years_experience ?? "unknown"} years, ${q.minYears}+ asked`);
    }
    const inPlace = !q.location || locationMatches(c.location, q.location);
    // Most records carry no location, so an unknown one is said rather than
    // counted against the person; only somebody known to be elsewhere misses.
    const unchecked: string[] = [];
    if (!inPlace) {
      if (c.location) missing.push(`based in ${c.location}`);
      else unchecked.push("location not on file, check");
    }
    if (q.availableNow && c.availability !== "available") {
      missing.push(c.availability === "notice_period" ? "on notice" : "not available");
    }

    const certRatio = q.certifications.length ? certificates.length / q.certifications.length : 1;
    const skillRatio = q.skills.length ? skills.length / q.skills.length : 1;
    const total =
      role.score * SCORING_WEIGHTS.role +
      skillRatio * SCORING_WEIGHTS.skills +
      certRatio * SCORING_WEIGHTS.certifications +
      experienceMatch(c.years_experience, q.minYears) * SCORING_WEIGHTS.experience +
      availabilityMatch(c.availability, q.availableNow ? "available" : null) * SCORING_WEIGHTS.availability;

    const result: TalentResult = {
      id: c.id,
      name: c.full_name,
      role: c.current_role,
      matchedRole: role.via && role.via !== c.current_role ? role.via : null,
      years: c.years_experience,
      location: c.location,
      availability: c.availability,
      score: Math.round(total),
      certificates,
      skills,
      missing,
      unchecked,
    };
    return { result, certRatio, roleScore: role.score, primary: role.fit && !role.via ? 0 : role.via === c.current_role ? 1 : 0 };
  });

  // Ties are common at the top, so the person whose current role is the one
  // asked for comes first, then the more experienced.
  const byScore = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    a.result.unchecked.length - b.result.unchecked.length ||
    b.result.score - a.result.score ||
    b.primary - a.primary ||
    (b.result.years ?? 0) - (a.result.years ?? 0) ||
    a.result.name.localeCompare(b.result.name);
  const fitting = scored.filter((s) => s.result.missing.length === 0).sort(byScore);
  const fits = fitting.slice(0, q.count).map((s) => s.result);

  let close: TalentResult[] = [];
  if (fits.length < q.count) {
    // Somebody who holds the certificates asked for is the nearer miss than
    // somebody with the right title and none of them: certificates are the
    // part of a request that cannot be trained in before a bid closes.
    close = scored
      .filter((s) => s.result.missing.length > 0 && (s.roleScore >= ROLE_NEAR || (q.certifications.length > 0 && s.certRatio > 0)))
      .sort((a, b) => b.certRatio - a.certRatio || byScore(a, b))
      .slice(0, q.count - fits.length)
      .map((s) => s.result);
  }
  return { fits, close, fitCount: fitting.length, searched: searched.length };
}
