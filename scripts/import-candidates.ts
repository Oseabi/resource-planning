/**
 * Load a candidate roster into the system.
 *
 *   npx tsx scripts/import-candidates.ts <file.csv> [--as <email>] [--apply]
 *                                        [--only <email,email>] [--skip-invalid]
 *                                        [--accept-roles "Actuary,Town Planner"]
 *   npx tsx scripts/import-candidates.ts --template
 *
 * Dry run is the default and prints a report saying exactly what it would do.
 * Nothing is written without --apply. There is no --force and no --yes.
 *
 * This is the lesser of the two ways a person gets into the system. A CV on the
 * TiPP Focus template parses into a full work history and education record,
 * which a spreadsheet row cannot hold, so anybody with a CV should be loaded
 * from it. This exists for people who have no CV yet, and for the five columns
 * no CV carries: availability, available_from, status, resource_categories and
 * notes. Setting those across a loaded pool is otherwise fifty trips through a
 * form.
 *
 * On a candidate who already has a CV on file, a column the CV filled in is
 * filled here only when it is empty, and never replaced. The report says what
 * it declined and why.
 *
 * It writes candidates and one activity row per created candidate. It never
 * touches placements, assignments, matches, tenders or storage, never runs
 * matching, never sets status to "placed", and never deletes a candidate: a
 * person missing from the CSV is not a deletion instruction.
 *
 * All the decisions live in src/lib/candidate-import.ts and are unit-tested.
 * This file is only the I/O around them, which is also why it builds its own
 * Supabase client: modules marked "server-only" cannot load outside Next.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv, delimiterName } from "@/lib/csv";
import { buildRoleIndex } from "@/lib/tender-import";
import {
  CANDIDATE_COLUMNS,
  readCandidateRows,
  buildCandidatePlan,
  formatCandidatePlan,
  type ExistingCandidate,
  type CandidateRowPlan,
} from "@/lib/candidate-import";
import { ALL_ROLES } from "@/lib/vocabulary";

function readEnv(): Record<string, string> {
  const file = path.resolve(".env.local");
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

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (has("template")) {
    console.log(CANDIDATE_COLUMNS.join(","));
    return;
  }

  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("usage: npx tsx scripts/import-candidates.ts <file.csv> [--as <email>] [--apply]");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }

  const apply = has("apply");
  const operatorEmail = flag("as");
  if (apply && !operatorEmail) {
    console.error("--apply needs --as <email>, so created_by names a real person.");
    process.exit(1);
  }

  const env = readEnv();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let operatorId: string | null = null;
  if (operatorEmail) {
    const { data: profiles } = await db.from("profiles").select("id, email").eq("email", operatorEmail);
    if (!profiles || profiles.length !== 1) {
      console.error(
        `--as ${operatorEmail} matched ${profiles?.length ?? 0} profiles. It has to match exactly one.`,
      );
      process.exit(1);
    }
    operatorId = profiles[0].id;
  }

  const [{ data: candidates }, { data: positions }] = await Promise.all([
    db.from("candidates").select("*"),
    db.from("positions").select("role"),
  ]);

  const existing: ExistingCandidate[] = (candidates ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    email: c.email,
    phone: c.phone,
    hasCv: Boolean(c.cv_file_path),
    columns: c as unknown as Record<string, unknown>,
  }));

  // A role is known if the vocabulary knows it, or if a real seat asks for it.
  //
  // Deliberately not seeded from the candidate pool, which is the one
  // difference from the tender importer. Feeding the pool back in would let the
  // first misspelling bless every row after it, which is exactly the drift this
  // check exists to stop. Seats are safe to trust: they are what candidates get
  // scored against, so a candidate spelled the way a seat is spelled matches.
  const seatRoles = [...new Set((positions ?? []).map((p) => p.role))].filter(Boolean);
  const accepted = (flag("accept-roles") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const index = buildRoleIndex([...ALL_ROLES], seatRoles, accepted);

  const table = parseCsv(fs.readFileSync(file, "utf8"));
  const { parsed, problems, unknownRoles } = readCandidateRows(table, index);

  const only = flag("only")?.split(",").map((v) => v.trim().toLowerCase());
  const selected = only
    ? parsed.filter(
        (p) =>
          (p.email && only.includes(p.email.toLowerCase())) ||
          only.includes(p.full_name.toLowerCase()),
      )
    : parsed;

  const plan = buildCandidatePlan(selected, existing);
  const rejects: CandidateRowPlan[] = problems.map((p) => ({
    kind: "reject" as const,
    line: p.line,
    name: p.name,
    reasons: p.reasons,
  }));
  plan.plans = [...rejects, ...plan.plans].sort(
    (a, b) => (a.kind === "reject" ? a.line : a.row.line) - (b.kind === "reject" ? b.line : b.row.line),
  );
  plan.summary.reject += rejects.length;

  const report = formatCandidatePlan(plan, {
    file,
    delimiter: delimiterName(table.delimiter),
    headers: table.headers,
    rowCount: table.rows.length,
    operator: operatorEmail ?? "not set, dry run only",
    apply,
    unknownRoles,
  });

  console.log(report);
  const reportPath = file.replace(/\.csv$/i, "") + ".report.txt";
  fs.writeFileSync(reportPath, report);
  console.log(`\nWrote ${reportPath}`);

  if (plan.summary.reject > 0 && !has("skip-invalid")) {
    console.error(
      `\n${plan.summary.reject} row(s) rejected. Nothing was written. Fix them, or pass --skip-invalid to load the rest.`,
    );
    process.exit(1);
  }

  if (!apply) return;

  let created = 0;
  let updated = 0;

  for (const p of plan.plans) {
    if (p.kind === "reject" || p.kind === "unchanged") continue;

    if (p.kind === "create") {
      // Only what the roster actually said. availability and status are left
      // out when blank so the column defaults apply, rather than this script
      // having an opinion about somebody it knows nothing about.
      const row: Record<string, unknown> = {
        full_name: p.row.full_name,
        email: p.row.email,
        phone: p.row.phone,
        location: p.row.location,
        current_role: p.row.current_role,
        additional_roles: p.row.additional_roles,
        years_experience: p.row.years_experience,
        designated_group: p.row.designated_group,
        qualifications: p.row.qualifications,
        certifications: p.row.certifications,
        technical_skills: p.row.technical_skills,
        skills: p.row.skills,
        sectors: p.row.sectors,
        languages: p.row.languages,
        resource_categories: p.row.resource_categories,
        available_from: p.row.available_from,
        notes: p.row.notes,
        created_by: operatorId,
      };
      if (p.row.availability) row.availability = p.row.availability;
      if (p.row.status) row.status = p.row.status;

      const { data, error } = await db.from("candidates").insert(row).select("id").single();
      if (error || !data) {
        console.error(`row ${p.row.line}: ${error?.message ?? "insert failed"}`);
        process.exit(1);
      }
      created += 1;

      // Says the record arrived by import, from which file and which row, and
      // that it carries no work history. In March that is the difference
      // between a thin profile somebody can explain and one nobody can.
      await db.from("activity").insert({
        entity_type: "candidate",
        entity_id: data.id,
        kind: "event",
        action: "imported",
        detail: {
          source: path.basename(file),
          row: p.row.line,
          note: "typed from a roster, so no work history or education",
        },
        actor_id: operatorId,
      });
      continue;
    }

    // Only the columns the plan approved. Anything the CV already answered was
    // dropped at plan time, so it cannot be written here by accident.
    const changes = Object.fromEntries(p.changes.map((c) => [c.column, c.to]));
    const { error } = await db.from("candidates").update(changes).eq("id", p.targetId);
    if (error) {
      console.error(`row ${p.row.line}: ${error.message}`);
      process.exit(1);
    }
    updated += 1;
  }

  console.log(`\nWrote ${created} new candidate(s) and updated ${updated}.`);
  console.log("Run supabase/orphan_check.sql, then Match Candidates on the live bids.");
}

main();
