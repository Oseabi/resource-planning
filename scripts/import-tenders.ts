/**
 * Load a tender register into the system.
 *
 *   npx tsx scripts/import-tenders.ts <file.csv> [--as <email>] [--apply]
 *                                     [--only <ref,ref>] [--skip-invalid]
 *                                     [--accept-roles "Actuary,Town Planner"]
 *   npx tsx scripts/import-tenders.ts --template
 *
 * Dry run is the default and prints a report saying exactly what it would do.
 * Nothing is written without --apply. There is no --force and no --yes.
 *
 * This is migration tooling for the initial load. Ongoing entry is the tender
 * form: bids are won weekly, and the moment somebody edits a tender in the app
 * the spreadsheet stops being the record. Re-running this after that point
 * would be a merge resolved by a script with no opinion.
 *
 * It writes tenders, positions and one activity row per created tender. It
 * never touches candidates, placements, assignments, matches or storage, never
 * runs matching, and never deletes a tender: a row missing from the CSV is not
 * a deletion instruction, because the register may be a partial extract.
 *
 * All the decisions live in src/lib/tender-import.ts and are unit-tested. This
 * file is only the I/O around them, which is also why it builds its own
 * Supabase client: modules marked "server-only" cannot load outside Next.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv, delimiterName } from "@/lib/csv";
import {
  IMPORT_COLUMNS,
  buildRoleIndex,
  readRows,
  buildPlan,
  formatPlan,
  rolesFromSeats,
  type ExistingTender,
  type ExistingPosition,
  type RowPlan,
} from "@/lib/tender-import";
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
    console.log(IMPORT_COLUMNS.join(","));
    return;
  }

  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("usage: npx tsx scripts/import-tenders.ts <file.csv> [--as <email>] [--apply]");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }

  const apply = has("apply");
  const operatorEmail = flag("as");
  if (apply && !operatorEmail) {
    // Every imported tender has to name somebody accountable for it, otherwise
    // the whole book of work reads as ownerless.
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

  // What is already stored, so the plan can tell a create from an update.
  const [{ data: tenders }, { data: positions }, { data: assignments }, { data: candidates }] =
    await Promise.all([
      db.from("tenders").select("*"),
      db.from("positions").select("id, role, quantity, min_experience_years, parent_type, parent_id"),
      db.from("assignments").select("position_id"),
      db.from("candidates").select("current_role, additional_roles"),
    ]);

  const seatFill = new Map<string, number>();
  for (const a of assignments ?? []) {
    seatFill.set(a.position_id, (seatFill.get(a.position_id) ?? 0) + 1);
  }

  const positionsByTender = new Map<string, ExistingPosition[]>();
  for (const p of positions ?? []) {
    if (p.parent_type !== "tender") continue;
    const list = positionsByTender.get(p.parent_id) ?? [];
    list.push({
      id: p.id,
      role: p.role,
      quantity: p.quantity,
      min_experience_years: p.min_experience_years,
      assignments: seatFill.get(p.id) ?? 0,
    });
    positionsByTender.set(p.parent_id, list);
  }

  const existing: ExistingTender[] = (tenders ?? []).map((t) => ({
    id: t.id,
    reference_number: t.reference_number,
    title: t.title,
    client: t.client,
    columns: t as unknown as Record<string, unknown>,
    positions: positionsByTender.get(t.id) ?? [],
  }));

  // The pool's own spellings count as known roles. Empty on the first import,
  // which is correct: the vocabulary is the only authority on day one.
  const poolRoles = [
    ...new Set(
      (candidates ?? []).flatMap((c) => [c.current_role, ...(c.additional_roles ?? [])]),
    ),
  ].filter((r): r is string => Boolean(r));
  // Roles the operator has confirmed for this run, named on the command line so
   // the decision is explicit and lands in the report.
  const accepted = (flag("accept-roles") ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const index = buildRoleIndex([...ALL_ROLES], poolRoles, accepted);

  const table = parseCsv(fs.readFileSync(file, "utf8"));
  const { parsed, problems, unknownRoles } = readRows(table, index);

  const only = flag("only")?.split(",").map((v) => v.trim().toUpperCase());
  const selected = only
    ? parsed.filter((p) => p.reference_number && only.includes(p.reference_number.toUpperCase()))
    : parsed;

  const plan = buildPlan(selected, existing);
  // Rows that failed to read at all are rejections too, and belong in the same
  // report rather than a separate stream nobody reads.
  const rejects: RowPlan[] = problems.map((p) => ({
    kind: "reject" as const,
    line: p.line,
    title: p.title,
    reasons: p.reasons,
  }));
  plan.plans = [...rejects, ...plan.plans].sort(
    (a, b) => (a.kind === "reject" ? a.line : a.row.line) - (b.kind === "reject" ? b.line : b.row.line),
  );
  plan.summary.reject += rejects.length;

  const report = formatPlan(plan, {
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
    // A half-imported register is harder to reason about than none.
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

    const columns = {
      title: p.row.title,
      reference_number: p.row.reference_number,
      client: p.row.client,
      location: p.row.location,
      value: p.row.value,
      submission_deadline: p.row.submission_deadline,
      contract_start_date: p.row.contract_start_date,
      contract_end_date: p.row.contract_end_date,
      status: p.row.status,
      min_experience_years: p.row.min_experience_years,
      reference_letters_required: p.row.reference_letters_required,
      required_skills: p.row.required_skills,
      required_certifications: p.row.required_certifications,
      sectors: p.row.sectors,
      // Not a CSV column. The detail page renders these as the role tags, so a
      // tender imported without them reads as having no roles at all.
      required_roles: rolesFromSeats(p.row.seats),
    };

    let tenderId: string;

    if (p.kind === "create") {
      const { data, error } = await db
        .from("tenders")
        .insert({ ...columns, created_by: operatorId })
        .select("id")
        .single();
      if (error || !data) {
        console.error(`row ${p.row.line}: ${error?.message ?? "insert failed"}`);
        process.exit(1);
      }
      tenderId = data.id;
      created += 1;
    } else {
      // Only the columns the register actually changed, so a blank cell cannot
      // erase a correction somebody made in the app.
      const changes = Object.fromEntries(p.columnChanges.map((c) => [c.column, c.to]));
      changes.required_roles = rolesFromSeats(p.row.seats);
      const { error } = await db.from("tenders").update(changes).eq("id", p.targetId);
      if (error) {
        console.error(`row ${p.row.line}: ${error.message}`);
        process.exit(1);
      }
      tenderId = p.targetId;
      updated += 1;
    }

    // Seats. Matched lines carry their id, so their assignments and match rows
    // survive; only genuinely dropped empty lines are removed.
    for (const removal of p.seats.removed) {
      const { error } = await db.from("positions").delete().eq("id", removal.id);
      if (error) console.error(`row ${p.row.line}: could not remove seat ${removal.role}: ${error.message}`);
    }

    for (const [order, seat] of p.seats.positions.entries()) {
      const row = {
        parent_type: "tender" as const,
        parent_id: tenderId,
        role: seat.role,
        quantity: seat.quantity,
        min_experience_years: seat.min_experience_years,
        sort_order: order,
      };
      const { error } = seat.id
        ? await db.from("positions").update(row).eq("id", seat.id)
        : await db.from("positions").insert(row);
      if (error) {
        console.error(`row ${p.row.line}: seat "${seat.role}": ${error.message}`);
        process.exit(1);
      }
    }

    if (p.kind === "create") {
      // Says the record arrived by import, from which file and which row. In
      // March that is the difference between a value somebody can trace and one
      // nobody can account for.
      await db.from("activity").insert({
        entity_type: "tender",
        entity_id: tenderId,
        kind: "event",
        action: "imported",
        detail: {
          source: path.basename(file),
          row: p.row.line,
          reference_number: p.row.reference_number ?? "none",
        },
        actor_id: operatorId,
      });
    }
  }

  console.log(`\nWrote ${created} new tender(s) and updated ${updated}.`);
  console.log("Run supabase/orphan_check.sql, then Match Candidates on the live bids.");
}

main();
