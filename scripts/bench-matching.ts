/**
 * Did matching actually get better, and where is it still blind.
 *
 *   npx tsx scripts/bench-matching.ts --out bench-matching-before.txt
 *   npx tsx scripts/bench-matching.ts --out bench-matching-after.txt \
 *     --baseline bench-matching-before.txt
 *
 * Scores every real candidate against every real seat with the scorer as it
 * stands, and prints three things:
 *
 *   1. Per seat, how many people clear the strong-match and alert thresholds,
 *      the top five scores, and the pool strength. Compared against a baseline
 *      file, it names every candidate whose score crossed a threshold.
 *      Widening how terms are compared can only add credit, so a score that
 *      DROPPED is a bug: the run exits non-zero on one.
 *   2. The backlog: required skills and certifications that no candidate
 *      matched at all, by frequency. That is the list the alias table should
 *      grow from, rather than from imagination.
 *   3. Every near match, as the pair that produced it. Read this by hand
 *      before trusting a release: it is the only thing standing between a
 *      sensible partial credit and a plausible-looking false positive.
 *
 * Reads production candidate rows, so it prints an initial and a surname and
 * never a profile. It writes nothing to the database. bench-*.txt is already
 * gitignored.
 *
 * Service-role, and that is correct only here: the point is to see every
 * candidate in every department, which is exactly what the app must not do.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { scoreCandidateForPosition, poolStrength } from "@/lib/matching";
import type { PositionInput } from "@/lib/positions";
import { overlapDetail, JOB_ALERT_THRESHOLD, TENDER_STRONG_MATCH_THRESHOLD } from "@/lib/scoring";

function readEnv(): Record<string, string> {
  const file = "./.env.local";
  if (!fs.existsSync(file)) {
    console.error("No .env.local found. Run this from the repo root.");
    process.exit(1);
  }
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

const flag = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};

/** "N Khumalo", never a profile. */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]} ${parts[parts.length - 1]}`;
}

/** One line per candidate per seat, the machine-readable half of the output. */
const SCORE_LINE = /^SCORE\t([^\t]+)\t([^\t]+)\t(\d+)$/;

function readBaseline(path: string): Map<string, number> {
  const scores = new Map<string, number>();
  if (!fs.existsSync(path)) {
    console.error(`No baseline at ${path}. Run this on main first with --out.`);
    process.exit(1);
  }
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = SCORE_LINE.exec(line);
    if (m) scores.set(`${m[1]}\t${m[2]}`, Number(m[3]));
  }
  return scores;
}

async function main() {
  const outPath = flag("out") ?? "bench-matching.txt";
  const baselinePath = flag("baseline");
  const baseline = baselinePath ? readBaseline(baselinePath) : null;

  const env = readEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Paged explicitly. The app relies on PostgREST's default thousand-row cap
  // without saying so, and whether the pool has outgrown it is one of the
  // things worth seeing here.
  const candidates: {
    id: string;
    full_name: string;
    current_role: string | null;
    additional_roles: string[];
    skills: string[];
    technical_skills: string[];
    certifications: string[];
    years_experience: number | null;
    availability: "available" | "notice_period" | "unavailable";
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("candidates")
      .select(
        "id, full_name, current_role, additional_roles, skills, technical_skills, certifications, years_experience, availability",
      )
      .eq("status", "active")
      .range(from, from + 999);
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    candidates.push(...((data ?? []) as typeof candidates));
    if (!data || data.length < 1000) break;
  }

  const { data: seatRows, error: seatErr } = await db
    .from("positions")
    .select("id, role, quantity, parent_type, parent_id, min_experience_years, required_skills, required_certifications, required_availability");
  if (seatErr) {
    console.error(seatErr.message);
    process.exit(1);
  }

  // Parent titles, so a seat reads as "SANRAL RFT / Business Analyst".
  const tenderIds = (seatRows ?? []).filter((s) => s.parent_type === "tender").map((s) => s.parent_id);
  const reqIds = (seatRows ?? []).filter((s) => s.parent_type === "job_requirement").map((s) => s.parent_id);
  const [{ data: tenders }, { data: reqs }] = await Promise.all([
    tenderIds.length ? db.from("tenders").select("id, title").in("id", tenderIds) : Promise.resolve({ data: [] }),
    reqIds.length ? db.from("job_requirements").select("id, title").in("id", reqIds) : Promise.resolve({ data: [] }),
  ]);
  const parentTitle = new Map<string, string>([
    ...(tenders ?? []).map((t) => [t.id, t.title] as [string, string]),
    ...(reqs ?? []).map((r) => [r.id, r.title] as [string, string]),
  ]);

  const out: string[] = [];
  const say = (line = "") => {
    out.push(line);
    console.log(line);
  };

  say(`candidates (active): ${candidates.length}`);
  say(`seats: ${seatRows?.length ?? 0}`);
  if (candidates.length === 1000) say("WARNING: exactly 1000 candidates read, the pool may be larger than one page.");
  say();

  const unmatched = new Map<string, number>();
  const nearPairs = new Map<string, number>();
  const crossedUp: string[] = [];
  const dropped: string[] = [];

  for (const seat of seatRows ?? []) {
    const position: PositionInput = {
      id: seat.id,
      role: seat.role,
      quantity: seat.quantity,
      min_experience_years: seat.min_experience_years,
      required_skills: seat.required_skills ?? [],
      required_certifications: seat.required_certifications ?? [],
      required_availability: seat.required_availability,
    };
    const label = `${parentTitle.get(seat.parent_id) ?? seat.parent_type} / ${seat.role}`;

    const scored = candidates
      .map((c) => ({ c, total: scoreCandidateForPosition(c, position).total }))
      .sort((a, b) => b.total - a.total);

    const clear70 = scored.filter((s) => s.total >= TENDER_STRONG_MATCH_THRESHOLD).length;
    const clear80 = scored.filter((s) => s.total >= JOB_ALERT_THRESHOLD).length;

    say(`=== ${label}`);
    say(
      `  clear ${TENDER_STRONG_MATCH_THRESHOLD}: ${clear70}   clear ${JOB_ALERT_THRESHOLD}: ${clear80}   pool strength: ${poolStrength(scored.map((s) => s.total))}`,
    );
    say(`  top: ${scored.slice(0, 5).map((s) => `${shortName(s.c.full_name)} ${s.total}`).join(", ") || "nobody"}`);

    for (const { c, total } of scored) {
      out.push(`SCORE\t${seat.id}\t${c.id}\t${total}`);
      if (!baseline) continue;
      const before = baseline.get(`${seat.id}\t${c.id}`);
      if (before == null) continue;
      if (total < before) dropped.push(`${label}: ${shortName(c.full_name)} ${before} to ${total}`);
      for (const threshold of [TENDER_STRONG_MATCH_THRESHOLD, JOB_ALERT_THRESHOLD]) {
        if (before < threshold && total >= threshold) {
          crossedUp.push(`${label}: ${shortName(c.full_name)} ${before} to ${total} (clears ${threshold})`);
        }
      }
    }

    // The backlog and the near pairs, read off the whole pool for this seat.
    const required = [...position.required_skills, ...position.required_certifications];
    for (const item of required) {
      let answered = 0;
      for (const c of candidates) {
        const detail = overlapDetail(
          [...c.skills, ...c.technical_skills, ...c.certifications],
          [item],
        );
        // items is absent on the scorer as it was before the alias layer, so
        // a baseline run on main still produces its SCORE lines and simply
        // reports no near pairs.
        const got = detail.items?.[0];
        if (got ? got.credit > 0 : detail.matched.length > 0) answered += 1;
        if (got?.quality === "near" && got.via) {
          const key = `${item}  <=  ${got.via}`;
          nearPairs.set(key, (nearPairs.get(key) ?? 0) + 1);
        }
      }
      if (answered === 0) unmatched.set(item, (unmatched.get(item) ?? 0) + 1);
    }
    say();
  }

  say("=== backlog: required terms nobody in the pool matched");
  const backlog = [...unmatched.entries()].sort((a, b) => b[1] - a[1]);
  if (backlog.length === 0) say("  none");
  for (const [item, seats] of backlog.slice(0, 60)) say(`  ${String(seats).padStart(3)} seats  ${item}`);
  say();

  say("=== near matches, for review by hand");
  const pairs = [...nearPairs.entries()].sort((a, b) => b[1] - a[1]);
  if (pairs.length === 0) say("  none");
  for (const [pair, n] of pairs.slice(0, 80)) say(`  ${String(n).padStart(4)}x  ${pair}`);
  say();

  if (baseline) {
    say("=== against the baseline");
    say(`  crossed a threshold: ${crossedUp.length}`);
    for (const line of crossedUp.slice(0, 60)) say(`    ${line}`);
    say(`  scores that dropped: ${dropped.length}`);
    for (const line of dropped.slice(0, 40)) say(`    ${line}`);
  }

  fs.writeFileSync(outPath, out.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${outPath}`);

  // Widening how terms compare can only add credit. A drop means a real
  // regression, so the run fails rather than printing it and moving on.
  if (dropped.length > 0) {
    console.error(`\n${dropped.length} score(s) went DOWN. That should be impossible; something regressed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
