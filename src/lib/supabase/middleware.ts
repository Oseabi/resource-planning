import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // A transient network failure reaching Supabase must not look like "logged
  // out", that would bounce users to /login mid-work and break in-flight
  // server actions. On network errors, let the request through: every data
  // read/write is still independently protected by Supabase auth + RLS.
  let user = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch {
    return response;
  }

  const path = request.nextUrl.pathname;
  const isPublicPath = PUBLIC_PATHS.some((p) => path.startsWith(p));
  const redirectTo = (pathname: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    return NextResponse.redirect(url);
  };

  if (!user) {
    return isPublicPath ? response : redirectTo("/login");
  }

  // The must-change-password gate used to be enforced here, which cost a
  // profiles query on every single request. It now lives in the (app) layout,
  // which already loads the profile, see getCurrentProfile. /set-password sits
  // outside (app), so there is no redirect loop.
  if (path === "/login") {
    return redirectTo("/dashboard");
  }

  return response;
}
