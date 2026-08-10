"use server";

import { createClient } from "@/lib/supabase/server";

export type SearchHitType = "candidate" | "tender" | "job_requirement" | "oem_letter";

export interface SearchHit {
  id: string;
  type: SearchHitType;
  title: string;
  subtitle: string | null;
  href: string;
}

/** Per entity type, so one busy table cannot crowd the others out of the list. */
const LIMIT_PER_TYPE = 5;

/** Below this the result set is too broad to be useful and every keystroke costs a query. */
const MIN_QUERY_LENGTH = 2;

/**
 * Make a user-typed string safe for a PostgREST filter.
 *
 * Two separate problems. `%` and `_` are LIKE wildcards, so "100%" would match
 * far more than intended. Commas, parentheses and dots are the syntax of a
 * PostgREST `or=(...)` filter, so leaving them in lets a stray comma split the
 * filter and produce a 400 rather than an empty result.
 */
function sanitise(query: string): string {
  return query
    .replace(/[%_\\]/g, "")
    .replace(/[,()*.:]/g, " ")
    .trim();
}

/**
 * Cross-entity search behind the Cmd+K palette.
 *
 * Candidates go through `search_text`, the column maintained by the
 * candidates_set_search_text trigger and backed by a trigram index (migration
 * 0004). It already concatenates name, role, skills and summary, so one `ilike`
 * covers all of them. The other three tables have no such column, so they match
 * on the fields someone would actually type: a title, a client, or a reference
 * number.
 */
export async function globalSearch(query: string): Promise<SearchHit[]> {
  const clean = sanitise(query);
  if (clean.length < MIN_QUERY_LENGTH) return [];

  const supabase = await createClient();
  const like = `%${clean}%`;

  const [candidates, tenders, requirements, letters] = await Promise.all([
    supabase
      .from("candidates")
      .select("id, full_name, current_role, location")
      .ilike("search_text", like)
      .limit(LIMIT_PER_TYPE),
    supabase
      .from("tenders")
      .select("id, title, client, status, reference_number")
      .or(`title.ilike.${like},client.ilike.${like},reference_number.ilike.${like}`)
      .limit(LIMIT_PER_TYPE),
    supabase
      .from("job_requirements")
      .select("id, title, client, required_role")
      .or(`title.ilike.${like},client.ilike.${like},required_role.ilike.${like}`)
      .limit(LIMIT_PER_TYPE),
    supabase
      .from("oem_letters")
      .select("id, title, oem_vendor, reference_number")
      .or(`title.ilike.${like},oem_vendor.ilike.${like},reference_number.ilike.${like}`)
      .limit(LIMIT_PER_TYPE),
  ]);

  const hits: SearchHit[] = [];

  for (const c of candidates.data ?? []) {
    hits.push({
      id: c.id,
      type: "candidate",
      title: c.full_name,
      subtitle: [c.current_role, c.location].filter(Boolean).join(" · ") || null,
      href: `/candidates/${c.id}`,
    });
  }

  for (const t of tenders.data ?? []) {
    hits.push({
      id: t.id,
      type: "tender",
      title: t.title,
      subtitle: [t.client, t.reference_number, t.status].filter(Boolean).join(" · ") || null,
      href: `/tenders/${t.id}`,
    });
  }

  for (const r of requirements.data ?? []) {
    hits.push({
      id: r.id,
      type: "job_requirement",
      title: r.title,
      subtitle: [r.client, r.required_role].filter(Boolean).join(" · ") || null,
      href: `/job-requirements/${r.id}`,
    });
  }

  for (const l of letters.data ?? []) {
    hits.push({
      id: l.id,
      type: "oem_letter",
      title: l.title,
      subtitle: [l.oem_vendor, l.reference_number].filter(Boolean).join(" · ") || null,
      href: `/oem-letters/${l.id}`,
    });
  }

  return hits;
}
