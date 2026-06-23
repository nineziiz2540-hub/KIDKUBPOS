import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "manager" | "staff";

export type ProfileWithTenant = {
  id: string;
  full_name: string | null;
  role: Role;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  tenants: {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    updated_at: string;
  };
};

export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async (): Promise<ProfileWithTenant | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*, tenants(*)")
    .eq("id", user.id)
    .single();

  return data as ProfileWithTenant | null;
});
