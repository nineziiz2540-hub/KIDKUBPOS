import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!existingProfile) {
        const displayName =
          (data.user.user_metadata?.full_name as string | undefined) ||
          (data.user.user_metadata?.name as string | undefined) ||
          data.user.email?.split("@")[0] ||
          "เจ้าของร้าน";

        const { error: rpcError } = await supabase.rpc("create_tenant_and_owner", {
          p_user_id: data.user.id,
          p_store_name: `ร้านของ ${displayName}`,
          p_has_backup_password: false,
        });

        if (rpcError) {
          console.error("OAuth first-login: create_tenant_and_owner failed:", rpcError);
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login`);
        }

        await supabase.from("profiles").update({ full_name: displayName }).eq("id", data.user.id);
      }

      return NextResponse.redirect(`${origin}/job-level`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
