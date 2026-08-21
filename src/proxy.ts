import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthed = user !== null;
  const isLoginPage = pathname === "/login";
  const isMfaChallengePage = pathname === "/mfa-challenge";
  const isPublicAuthRoute =
    isLoginPage ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/auth/callback");

  if (!isAuthed && !isPublicAuthRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthed && !isMfaChallengePage) {
    // Called with no argument, getAuthenticatorAssuranceLevel() computes nextLevel from
    // getSession()'s cached session.user.factors — a snapshot frozen into the cookie at the time
    // it was last written, not re-validated against the server. That's stale exactly when a
    // factor is removed out from under an existing session by another code path (e.g. backup-code
    // recovery, which uses the service-role admin client and has no way to rewrite this session's
    // own cookie) — the middleware would otherwise keep computing "still needs aal2" forever from
    // the old snapshot and redirect-loop between here and /mfa-challenge. Passing the access token
    // explicitly takes the SDK's other code path, which calls getUser(jwt) internally — a real
    // network-validated fetch of the current user record, with accurate, current factors.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(
        session.access_token
      );
      if (aal && aal.currentLevel !== aal.nextLevel) {
        return NextResponse.redirect(new URL("/mfa-challenge", request.url));
      }
    }
  }

  if (isAuthed && (isLoginPage || pathname === "/register")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js|sw\\.js\\.map).*)",
  ],
};
