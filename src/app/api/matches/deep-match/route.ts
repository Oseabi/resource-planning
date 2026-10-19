import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordAudit } from "@/app/(app)/audit-actions";
import { deepMatchSeat, isDeepMatchConfigured } from "@/lib/deep-match/groq";
import {
  AI_RERANK_N,
  deepMatchNote,
  deepMatchUpdate,
  type DeepMatchCandidate,
} from "@/lib/deep-match/fields";

/**
 * A 20 second Groq timeout plus the reads around it has to fit inside what the
 * host allows a function, and maxDuration is a route-segment export with no
 * server-action equivalent. That is why this is a route and not an action.
 */
export const maxDuration = 60;

/**
 * Ask Groq to read one seat's shortlist and say who it would interview first.
 *
 * One seat per request, enforced. Ten seats would be ten calls, about thirty
 * thousand tokens against a budget of eight thousand a minute, and four
 * minutes of wall clock against a sixty second ceiling. There is deliberately
 * no "deep match every seat" button.
 *
 * The profiles leave the country, so the audit line is written before the
 * call, not after: the question it answers is whether they left, and they
 * left the moment the request went. No name is sent, only the structured
 * lists, which is a stronger posture than CV extraction has.
 *
 * Nothing is written on failure, and the only column this can ever write is
 * ai_deep_match_notes. The score is read as context and never touched.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  if (!isDeepMatchConfigured()) {
    return NextResponse.json({ error: "Deep match is off until GROQ_API_KEY is set." }, { status: 400 });
  }

  const { positionId } = (await request.json().catch(() => ({}))) as { positionId?: string };
  if (!positionId) return NextResponse.json({ error: "No seat given." }, { status: 400 });

  const { data: seat } = await supabase
    .from("positions")
    .select("id, role, parent_type, parent_id, min_experience_years, required_skills, required_certifications, notes")
    .eq("id", positionId)
    .single();
  if (!seat) return NextResponse.json({ error: "That seat no longer exists." }, { status: 404 });

  // The shortlist exactly as the screen shows it: the same five, in the same
  // order. Reranking people the user cannot see would be an order they have
  // no way to check.
  const { data: matchRows } = await supabase
    .from("matches")
    .select("candidate_id, score")
    .eq("match_target_type", "position")
    .eq("match_target_id", positionId)
    // Tie broken on the id, because score alone is not a total order: four
    // people tied on one live seat straddle the top-five cut, and without a
    // tiebreaker this and the screen could send and show different fives, so
    // a note would land on somebody the user is not looking at.
    .order("score", { ascending: false })
    .order("candidate_id", { ascending: true })
    .limit(AI_RERANK_N);

  if (!matchRows || matchRows.length < 2) {
    return NextResponse.json(
      { error: "There are not enough matches on this seat to rank. Run matching first." },
      { status: 400 },
    );
  }

  const { data: people } = await supabase
    .from("candidates")
    .select("id, current_role, additional_roles, skills, technical_skills, certifications, years_experience, availability")
    .in(
      "id",
      matchRows.map((m) => m.candidate_id),
    );
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  // The index is the only handle the model is given. The mapping stays here,
  // so a number it invents can address nobody.
  const order = matchRows.filter((m) => byId.has(m.candidate_id));
  const candidates: DeepMatchCandidate[] = order.map((m, i) => {
    const p = byId.get(m.candidate_id)!;
    return {
      index: i + 1,
      currentRole: p.current_role,
      additionalRoles: p.additional_roles ?? [],
      skills: p.skills ?? [],
      technicalSkills: p.technical_skills ?? [],
      certifications: p.certifications ?? [],
      yearsExperience: p.years_experience,
      availability: p.availability,
      score: m.score,
    };
  });

  await recordAudit({
    action: "sent_for_ai_deep_match",
    entityType: "position",
    entityId: seat.id,
    entityLabel: seat.role,
    detail: {
      provider: "groq",
      candidate_ids: order.map((m) => m.candidate_id),
      candidates: candidates.length,
      parent_type: seat.parent_type,
      parent_id: seat.parent_id,
    },
  });

  const result = await deepMatchSeat(
    {
      role: seat.role,
      requiredSkills: seat.required_skills ?? [],
      requiredCertifications: seat.required_certifications ?? [],
      minExperienceYears: seat.min_experience_years,
      notes: seat.notes,
    },
    candidates,
  );
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 502 });

  // An update, never an upsert: a note must not be able to create a match row
  // that scoring did not create. Written through the caller's own client, so
  // the department policy on matches decides whether it is allowed.
  let written = 0;
  for (const entry of result.entries) {
    const candidateId = order[entry.candidate - 1]?.candidate_id;
    if (!candidateId) continue;
    const { error } = await supabase
      .from("matches")
      .update(deepMatchUpdate(deepMatchNote(entry, candidates.length, result.model)))
      .eq("candidate_id", candidateId)
      .eq("match_target_type", "position")
      .eq("match_target_id", positionId);
    if (!error) written += 1;
  }

  if (written === 0) {
    return NextResponse.json({ error: "The notes could not be saved against this seat." }, { status: 403 });
  }

  return NextResponse.json({ written, model: result.model, note: result.note ?? null });
}
