import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { MfaChallengeForm } from "@/components/auth/mfa-challenge-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function MfaChallengePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel === aal.nextLevel) {
    redirect("/");
  }

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verifiedFactor = factors?.totp.find((f) => f.status === "verified");
  if (!verifiedFactor) {
    redirect("/");
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">ยืนยันตัวตน 2 ชั้น</CardTitle>
        <CardDescription>กรอกรหัส 6 หลักจากแอป Authenticator ของคุณ</CardDescription>
      </CardHeader>
      <CardContent>
        <MfaChallengeForm factorId={verifiedFactor.id} />
      </CardContent>
    </Card>
  );
}
