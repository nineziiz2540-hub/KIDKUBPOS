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
