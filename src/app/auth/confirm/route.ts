import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isConfirmType, safeNext, NEXT_AFTER } from "@/lib/auth/links";

/**
 * Where a sign-in link from one of the app's own emails lands.
 *
 * The link carries a one-time token minted by Supabase. This trades it for
 * a session, sets the session cookies, and sends the person on: a new
 * account to choose its password, a forgotten one to reset it. A token
 * that has expired or been used lands on the sign-in page with a line
 * saying so, rather than on a blank reset form with no session behind it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (tokenHash && isConfirmType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next"), NEXT_AFTER[type]), url.origin));
    }
  }

  return NextResponse.redirect(new URL("/login?link=expired", url.origin));
}
