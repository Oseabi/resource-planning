"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { readRequestWithAi } from "@/lib/talent-search/ai";
import {
  describeQuery,
  hasCriteria,
  parseTalentRequest,
  refineQuery,
  type TalentQuery,
} from "@/lib/talent-search/query";
import { rankTalent, type PoolCandidate, type TalentResult } from "@/lib/talent-search/rank";

export interface TalentReply {
  /** The criteria the request was read as, to send back with the next message. */
  query: TalentQuery | null;
  /** The criteria in a line, for the person to check. */
  reading: string | null;
  text: string;
  fits: TalentResult[];
  close: TalentResult[];
  readBy: "ai" | "rules" | null;
}

const HELP =
  'Tell me who you need, for example "3 software developers with MB-500", "5 business analysts in Cape Town with 8+ years" or "2 Java developers available now". You can then refine: "make it 5", "only in Gauteng", "also with AZ-900".';

/**
 * The candidate finder behind the chat panel.
 *
 * Reads with the signed-in person's own client, so the row rules decide who is
 * searched exactly as on the candidates list. Nothing is written.
 */
export async function findTalent(message: string, previous: TalentQuery | null): Promise<TalentReply> {
  const text = message.trim().slice(0, 600);
  if (!text) return { query: previous, reading: null, text: HELP, fits: [], close: [], readBy: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { query: previous, reading: null, text: "Your session has expired. Sign in again.", fits: [], close: [], readBy: null };

  const byRules = refineQuery(previous, text, parseTalentRequest(text));
  const byAi = await readRequestWithAi(text, previous);
  // The AI reading is used when it found something to search on; the rules'
  // exam codes are kept either way, since a code is never ambiguous.
  let query = byAi && hasCriteria(byAi) ? byAi : byRules;
  const readBy: TalentReply["readBy"] = byAi && hasCriteria(byAi) ? "ai" : "rules";
  const codes = byRules.certifications.filter((c) => /^[A-Z]{2}-\d{3}$/.test(c));
  if (codes.some((c) => !query.certifications.includes(c))) {
    query = { ...query, certifications: [...new Set([...query.certifications, ...codes])] };
  }

  if (!hasCriteria(query)) {
    return { query: previous, reading: null, text: `I could not tell who you are looking for. ${HELP}`, fits: [], close: [], readBy };
  }

  const [{ data: people, error }, { data: documents }] = await Promise.all([
    fetchAll<Omit<PoolCandidate, "certificateDocuments">>((from, to) =>
      supabase
        .from("candidates")
        .select("id, full_name, current_role, additional_roles, skills, technical_skills, certifications, years_experience, availability, status, location")
        .order("id")
        .range(from, to),
    ),
    fetchAll<{ candidate_id: string; title: string }>((from, to) =>
      supabase.from("candidate_attachments").select("candidate_id, title, id").eq("kind", "certificate").order("id").range(from, to),
    ),
  ]);
  if (error) return { query, reading: describeQuery(query), text: `The search failed: ${error}`, fits: [], close: [], readBy };

  const docsByPerson = new Map<string, string[]>();
  for (const d of documents) docsByPerson.set(d.candidate_id, [...(docsByPerson.get(d.candidate_id) ?? []), d.title]);
  const pool: PoolCandidate[] = people.map((p) => ({ ...p, certificateDocuments: docsByPerson.get(p.id) ?? [] }));

  const answer = rankTalent(pool, query);
  const who = query.role ? `${query.role.toLowerCase()}${query.count === 1 ? "" : "s"}` : query.count === 1 ? "person" : "people";
  let reply: string;
  if (answer.fitCount === 0) {
    reply = answer.close.length
      ? `Nobody among ${answer.searched} active candidates meets all of that. Here are the ${answer.close.length} closest, with what each one lacks.`
      : `Nobody among ${answer.searched} active candidates comes close. Try fewer requirements.`;
  } else if (answer.fitCount < query.count) {
    reply = `Only ${answer.fitCount} ${answer.fitCount === 1 ? "candidate meets" : "candidates meet"} everything you asked for.${
      answer.close.length ? ` The next ${answer.close.length} closest are below them, with what they lack.` : ""
    }`;
  } else {
    reply = `Here ${query.count === 1 ? "is the best" : `are the best ${query.count}`} ${who}${
      answer.fitCount > query.count ? ` of ${answer.fitCount} who meet everything` : ""
    }.`;
  }
  const noPlace = answer.fits.filter((r) => r.unchecked.length > 0).length;
  if (noPlace > 0 && query.location) {
    reply += ` ${noPlace} of them ${noPlace === 1 ? "has" : "have"} no location on file, so check that before you send them.`;
  }
  return { query, reading: describeQuery(query), text: reply, fits: answer.fits, close: answer.close, readBy };
}
