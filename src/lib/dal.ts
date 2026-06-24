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

export type DashboardStats = {
  todaySales: number;
  todayOrders: number;
  yesterdaySales: number;
  yesterdayOrders: number;
};

export async function getDashboardStats(tenantId: string): Promise<DashboardStats> {
  // Bangkok = UTC+7; compute day boundaries in Bangkok time
  const offsetMs = 7 * 60 * 60 * 1000;
  const bangkokNow = new Date(Date.now() + offsetMs);
  const bangkokMidnightUTC = Date.UTC(
    bangkokNow.getUTCFullYear(),
    bangkokNow.getUTCMonth(),
    bangkokNow.getUTCDate()
  );
  const todayStart = new Date(bangkokMidnightUTC - offsetMs);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

  const supabase = await createClient();

  const [{ data: todayRows }, { data: yesterdayRows }] = await Promise.all([
    supabase
      .from("orders")
      .select("total")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .gte("created_at", todayStart.toISOString())
      .lt("created_at", tomorrowStart.toISOString()),
    supabase
      .from("orders")
      .select("total")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .gte("created_at", yesterdayStart.toISOString())
      .lt("created_at", todayStart.toISOString()),
  ]);

  const today = (todayRows ?? []) as { total: number }[];
  const yesterday = (yesterdayRows ?? []) as { total: number }[];

  return {
    todaySales: today.reduce((sum, r) => sum + Number(r.total), 0),
    todayOrders: today.length,
    yesterdaySales: yesterday.reduce((sum, r) => sum + Number(r.total), 0),
    yesterdayOrders: yesterday.length,
  };
}

export type TopProduct = {
  product_name: string;
  total_qty: number;
  total_sales: number;
};

export async function getTopProducts(
  tenantId: string,
  limit = 5
): Promise<TopProduct[]> {
  const supabase = await createClient();

  const { data: orderRows } = (await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")) as { data: { id: string }[] | null };

  if (!orderRows || orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => r.id);

  const { data: items } = (await supabase
    .from("order_items")
    .select("product_name, quantity, subtotal")
    .in("order_id", orderIds)) as {
    data: { product_name: string; quantity: number; subtotal: number }[] | null;
  };

  if (!items) return [];

  const map = new Map<string, { total_qty: number; total_sales: number }>();
  for (const row of items) {
    const prev = map.get(row.product_name) ?? { total_qty: 0, total_sales: 0 };
    map.set(row.product_name, {
      total_qty: prev.total_qty + row.quantity,
      total_sales: prev.total_sales + Number(row.subtotal),
    });
  }

  return [...map.entries()]
    .map(([product_name, s]) => ({ product_name, ...s }))
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, limit);
}

export type TeamMember = {
  id: string;
  full_name: string | null;
  role: Role;
  created_at: string;
};

export async function getTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  return (data ?? []) as TeamMember[];
}
