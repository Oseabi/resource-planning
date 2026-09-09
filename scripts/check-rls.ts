/**
 * Does the department scoping actually hold?
 *
 *   npx tsx scripts/check-rls.ts <manager-email>
 *
 * Runs every check as that person, through the ordinary anon key, so the
 * policies are live. This is the only honest way to test them: a query in the
 * SQL Editor runs as postgres and a script on the service-role key runs as the
 * owner, and both bypass RLS entirely, so everything looks correct whether the
 * policies work or not.
 *
 * The session comes from the admin API rather than a password. Nothing here
 * sees, asks for, or enters a credential.
 *
 * The account must NOT be an admin. is_admin() short circuits every predicate,
 * so running this as an admin returns full counts and proves nothing, which is
 * the easiest way to conclude the scoping works when it does not.
 *
 * Read-only in effect: the three writes it attempts are all meant to be
 * refused, and the one row it creates to make the shared-pool check meaningful
 * is removed again at the end.
 */
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

let failures = 0;
const pass = (m: string) => console.log(`  PASS  ${m}`);
const skip = (m: string) => console.log(`  SKIP  ${m}`);
const fail = (m: string) => {
  console.log(`  FAIL  ${m}`);
  failures += 1;
};

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = SupabaseClient<any, any, any>;

async function sessionFor(email: string): Promise<Client> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) {
    console.error(`Could not get a session for ${email}: ${error?.message ?? "no token"}`);
    process.exit(1);
  }
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: otpError } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (otpError) {
    console.error(`Could not establish the session: ${otpError.message}`);
    process.exit(1);
  }
  return client as Client;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: npx tsx scripts/check-rls.ts <manager-email>");
    process.exit(1);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, department_id, departments(name)")
    .eq("email", email)
    .single();

  if (!profile) {
    console.error(`No profile for ${email}.`);
    process.exit(1);
  }
  if (profile.role === "admin") {
    console.error(
      `${email} is an admin, so every policy short circuits and this would prove nothing.\n` +
        "Use a manager or user account.",
    );
    process.exit(1);
  }
  if (!profile.department_id) {
    console.error(`${email} has no department, so they should see nothing. Assign one first.`);
    process.exit(1);
  }

  // The untyped client returns an embed as an array here, unlike the typed
  // one used in the app, which declares the relationship as to-one.
  const embedded = profile.departments as unknown as { name: string }[] | { name: string } | null;
  const theirDepartment =
    (Array.isArray(embedded) ? embedded[0]?.name : embedded?.name) ?? "unknown";
  console.log(`Acting as ${email}, ${profile.role} of ${theirDepartment}\n`);

  const asThem = await sessionFor(email);

  // Somebody else's department, for the refusal checks.
  const { data: otherDepartment } = await admin
    .from("departments")
    .select("id, name")
    .neq("id", profile.department_id)
    .limit(1)
    .single();

  // ------------------------------------------------------------------ 1 ---
  console.log("1. What they can see");
  const [{ data: theirs }, { count: allTenders }] = await Promise.all([
    asThem.from("tenders").select("id, title, department_id"),
    admin.from("tenders").select("*", { count: "exact", head: true }),
  ]);
  const wrong = (theirs ?? []).filter((t) => t.department_id !== profile.department_id);
  if (wrong.length > 0) {
    fail(`sees ${wrong.length} tender(s) from another department: ${wrong.map((t) => t.title).join(", ")}`);
  } else if ((allTenders ?? 0) === 0) {
    skip("no tenders exist, so this proves nothing either way");
  } else if ((theirs ?? []).length === (allTenders ?? 0)) {
    skip(`every tender happens to be in ${theirDepartment}, so this proves nothing`);
  } else {
    pass(`sees ${theirs?.length ?? 0} of ${allTenders} tenders, all in ${theirDepartment}`);
  }

  // A shared table that is empty passes this trivially, 0 equals 0 either way,
  // so a row goes in to make it mean something and comes out at the end.
  const { data: probe } = await admin
    .from("candidates")
    .insert({ full_name: "RLS CHECK probe (delete me)", current_role: "Business Analyst" })
    .select("id")
    .single();

  for (const t of ["candidates", "oem_letters", "reference_letters"] as const) {
    const [{ count: mine }, { count: all }] = await Promise.all([
      asThem.from(t).select("*", { count: "exact", head: true }),
      admin.from(t).select("*", { count: "exact", head: true }),
    ]);
    if (mine !== all) fail(`${t}: sees ${mine} of ${all}, so the shared pool has been scoped`);
    else if ((all ?? 0) === 0) skip(`${t} is empty, so this proves nothing either way`);
    else pass(`${t} shared: sees all ${all}`);
  }

  const { error: rpcError } = await asThem.rpc("candidate_commitments");
  if (rpcError) fail(`candidate_commitments: ${rpcError.message}`);
  else pass("candidate_commitments readable, so availability stays company wide");

  // ------------------------------------------------------------------ 2 ---
  console.log("\n2. Filing a bid into another department");
  if (!otherDepartment) {
    skip("only one department exists");
  } else {
    const { error } = await asThem
      .from("tenders")
      .insert({ title: "RLS CHECK leak test", department_id: otherDepartment.id });
    if (error) pass(`refused: ${error.message.slice(0, 70)}`);
    else fail(`ACCEPTED into ${otherDepartment.name}, so a manager can file anywhere`);
  }

  // ------------------------------------------------------------------ 3 ---
  console.log("\n3. Moving themselves into another department");
  if (otherDepartment) {
    const { error } = await asThem
      .from("profiles")
      .update({ department_id: otherDepartment.id })
      .eq("id", profile.id);
    if (error) pass(`refused: ${error.message.slice(0, 70)}`);
    else fail("ACCEPTED, which is a straight privilege escalation");
  }

  // ------------------------------------------------------------------ 4 ---
  console.log("\n4. Deleting another department's tender");
  const { data: notTheirs } = await admin
    .from("tenders")
    .select("id, title")
    .neq("department_id", profile.department_id)
    .limit(1)
    .maybeSingle();

  if (!notTheirs) {
    skip("no tender exists outside their department");
  } else {
    const { data: deleted, error } = await asThem
      .from("tenders")
      .delete()
      .eq("id", notTheirs.id)
      .select("id");
    if (error) pass(`refused outright: ${error.message.slice(0, 60)}`);
    else if (!deleted || deleted.length === 0) {
      pass("zero rows and no error, which is why the delete actions count rows");
    } else fail(`DELETED "${notTheirs.title}"`);

    const { count: still } = await admin
      .from("tenders")
      .select("*", { count: "exact", head: true })
      .eq("id", notTheirs.id);
    if (still === 1) pass(`"${notTheirs.title}" is still there`);
    else fail(`"${notTheirs.title}" is GONE`);
  }

  // ------------------------------------------------------------------ 5 ---
  console.log("\n5. The audit trail");
  const { count: trailSize } = await admin.from("audit_log").select("*", { count: "exact", head: true });

  const { data: tampered } = await asThem
    .from("audit_log")
    .update({ action: "tampered" })
    .neq("action", "__none__")
    .select("id");
  if (!tampered || tampered.length === 0) pass("update affected zero rows");
  else fail(`UPDATED ${tampered.length} row(s), so the trail is editable`);

  const { data: purged } = await asThem
    .from("audit_log")
    .delete()
    .neq("action", "__none__")
    .select("id");
  if (!purged || purged.length === 0) pass("delete affected zero rows");
  else fail(`DELETED ${purged.length} row(s), so the trail can be tidied`);

  const { data: readable } = await asThem.from("audit_log").select("id");
  if (readable && readable.length > 0) fail(`a non-admin can read ${readable.length} audit row(s)`);
  else if ((trailSize ?? 0) === 0) skip("the trail is empty, so the read check proves nothing");
  else pass(`cannot read the trail, though ${trailSize} entries exist`);

  if (probe) {
    await admin.from("candidates").delete().eq("id", probe.id);
    console.log("\nremoved the probe candidate");
  }
  await asThem.auth.signOut();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
