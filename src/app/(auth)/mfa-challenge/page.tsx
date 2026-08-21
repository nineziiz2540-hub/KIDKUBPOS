import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { MfaChallengeForm } from "@/components/auth/mfa-challenge-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function MfaChallengePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  // Check FRESH data first, same reasoning as the fix in src/proxy.ts: listFactors() is
  // network-validated (calls getUser() internally), while getAuthenticatorAssuranceLevel()'s
  // no-arg form reads session.user.factors — a snapshot cached in this cookie at the time it was
  // last written. Checking the stale form first (as this page originally did) reopens the exact
  // redirect loop proxy.ts was fixed to close, just from the opposite direction: if a factor was
  // enrolled from ANOTHER session (a second device/tab) after this cookie was written, this page's
  // stale check would see "no factor" and bounce to "/", which proxy.ts's now-fresh check would
  // immediately bounce right back here — a closed loop between this page and the middleware.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verifiedFactor = factors?.totp.find((f) => f.status === "verified");
  if (!verifiedFactor) {
    redirect("/");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const payload = session?.access_token.split(".")[1];
  const currentAal = payload
    ? (JSON.parse(Buffer.from(payload, "base64url").toString()).aal as string | undefined)
    : undefined;
  if (currentAal === "aal2") {
    redirect("/");
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">ยืนยันตัวตน 2 ชั้น</CardTitle>
        <CardDescription>กรอกรหัส 6 หลักจากแอป Authenticator ของคุณ</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MfaChallengeForm factorId={verifiedFactor.id} />
        {/* Escape hatch: without this, an Owner who has lost both their authenticator app and
            their backup codes has no in-app way out at all — proxy.ts redirects every other path,
            including /login itself, back here. Signing out at least lets them leave this page;
            recovering into the account still requires a backup code or admin intervention. */}
        <form action={signOut} className="text-center">
          <button type="submit" className="text-sm text-muted-foreground hover:underline">
            ออกจากระบบ
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
