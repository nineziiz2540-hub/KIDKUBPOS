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

  // The underlying Supabase session is shared by the whole device/terminal — only the Owner has
  // real login credentials; Manager/Staff have no password of their own and get into their own
  // identity purely via a PIN (see switchToMember in job-level.ts), which swaps this same session
  // to their own auth.uid(). Gating on "is the raw session's account MFA-enrolled" (the old
  // condition) meant the 2FA wall appeared on the very first request after Owner's password
  // login — before anyone had even reached the job-level tile picker — permanently locking out
  // Manager/Staff any time the Owner's own 2FA hadn't been completed yet, even though they were
  // never trying to act as Owner. `worker_verified` is only ever set to `user.id` once someone has
  // PIN-confirmed they're operating as the currently-authenticated identity (verifyOwnPin/
  // setOwnPin for Owner confirming themselves, switchToMember for Manager/Staff confirming
  // themselves post session-swap) — so gating on that instead means the wall only appears once
  // someone has actually confirmed they're acting as the Owner specifically.
  const workerVerified = request.cookies.get("worker_verified")?.value;
  const isConfirmedAsCurrentUser = workerVerified === user?.id;

  if (isAuthed && !isMfaChallengePage && isConfirmedAsCurrentUser) {
    // getAuthenticatorAssuranceLevel() (in either its no-arg or jwt-arg form) ultimately needs the
    // same two facts we can already derive locally: whether a verified factor exists, and what AAL
    // the current token already proves. `user` above came from getUser(), which network-validates
    // and returns CURRENT factors — never the getSession()-cached, possibly-stale-if-a-factor-was-
    // just-removed-via-the-admin-client snapshot that caused a real redirect loop between here and
    // /mfa-challenge after backup-code recovery (see git history). Deriving both facts from data we
    // already fetched avoids a second GET /user per authenticated request while staying just as
    // fresh: the token itself was already proven valid by the getUser() call above, so decoding its
    // aal claim without a second signature check is safe.
    const hasVerifiedFactor = user.factors?.some((f) => f.status === "verified") ?? false;
    if (hasVerifiedFactor) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const payload = session?.access_token.split(".")[1];
      const currentAal = payload
        ? (JSON.parse(Buffer.from(payload, "base64url").toString()).aal as string | undefined)
        : undefined;
      if (currentAal !== "aal2") {
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
