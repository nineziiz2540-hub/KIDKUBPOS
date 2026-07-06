import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ModifierWithOptions, ProductCost, LowStockAlert } from "@/types/app";

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

export type Customer = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type RawMaterial = {
  id: string;
  tenant_id: string;
  name: string;
  unit: string;
  cost_per_unit: number;
  current_stock: number;
  min_stock_alert: number;
  created_at: string | null;
  updated_at: string | null;
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

export async function getCustomerByPhone(
  phone: string,
  tenantId: string
): Promise<Customer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .single();
  return data as Customer | null;
}

export async function getRawMaterials(tenantId: string): Promise<RawMaterial[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("raw_materials")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name");
  return (data ?? []) as RawMaterial[];
}

export async function getModifiers(tenantId: string): Promise<ModifierWithOptions[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("modifiers")
    .select(
      `id, name, is_required, is_multi_select, sort_order,
       modifier_options(id, name, price_delta, sort_order)`
    )
    .eq("tenant_id", tenantId)
    .order("sort_order");

  if (!data) return [];

  type ModRow = {
    id: string;
    name: string;
    is_required: boolean;
    is_multi_select: boolean;
    sort_order: number | null;
    modifier_options: Array<{
      id: string;
      name: string;
      price_delta: number | null;
      sort_order: number | null;
    }>;
  };

  return (data as ModRow[]).map((m) => ({
    id: m.id,
    name: m.name,
    isRequired: m.is_required,
    isMultiSelect: m.is_multi_select,
    sortOrder: m.sort_order ?? 0,
    options: (m.modifier_options ?? [])
      .map((o) => ({
        id: o.id,
        name: o.name,
        priceDelta: Number(o.price_delta ?? 0),
        sortOrder: o.sort_order ?? 0,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

export async function getLowStockAlerts(
  tenantId: string
): Promise<LowStockAlert[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("raw_materials")
    .select("id, name, unit, current_stock, min_stock_alert")
    .eq("tenant_id", tenantId);

  return ((data ?? []) as Array<{
    id: string;
    name: string;
    unit: string;
    current_stock: number;
    min_stock_alert: number;
  }>)
    .filter(
      (m) =>
        Number(m.min_stock_alert) > 0 &&
        Number(m.current_stock) <= Number(m.min_stock_alert)
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      currentStock: Number(m.current_stock),
      minStockAlert: Number(m.min_stock_alert),
    }));
}

export async function getModifiersForProduct(
  productId: string
): Promise<ModifierWithOptions[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_modifiers")
    .select(
      `modifiers(
        id, name, is_required, is_multi_select, sort_order,
        modifier_options(id, name, price_delta, sort_order)
      )`
    )
    .eq("product_id", productId);

  if (!data) return [];

  type ModRow = {
    id: string;
    name: string;
    is_required: boolean;
    is_multi_select: boolean;
    sort_order: number | null;
    modifier_options: Array<{
      id: string;
      name: string;
      price_delta: number | null;
      sort_order: number | null;
    }>;
  };

  return (data as Array<{ modifiers: ModRow | null }>)
    .map((pm) => pm.modifiers)
    .filter((m): m is ModRow => m !== null)
    .map((m) => ({
      id: m.id,
      name: m.name,
      isRequired: m.is_required,
      isMultiSelect: m.is_multi_select,
      sortOrder: m.sort_order ?? 0,
      options: (m.modifier_options ?? [])
        .map((o) => ({
          id: o.id,
          name: o.name,
          priceDelta: Number(o.price_delta ?? 0),
          sortOrder: o.sort_order ?? 0,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getProductCost(productId: string): Promise<ProductCost> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_recipes")
    .select("quantity_used, raw_materials(name, unit, cost_per_unit)")
    .eq("product_id", productId);

  if (!data) return { productId, ingredientCost: 0, recipes: [] };

  type RecipeRow = {
    quantity_used: number;
    raw_materials: { name: string; unit: string; cost_per_unit: number } | null;
  };

  const recipes = (data as RecipeRow[])
    .filter((r) => r.raw_materials !== null)
    .map((r) => {
      const mat = r.raw_materials!;
      const quantityUsed = Number(r.quantity_used);
      const costPerUnit = Number(mat.cost_per_unit);
      return {
        materialName: mat.name,
        unit: mat.unit,
        quantityUsed,
        costPerUnit,
        lineCost: quantityUsed * costPerUnit,
      };
    });

  return {
    productId,
    ingredientCost: recipes.reduce((sum, r) => sum + r.lineCost, 0),
    recipes,
  };
}

export async function getSalesByHour(
  tenantId: string,
  date: string // "YYYY-MM-DD" in Bangkok time
): Promise<{ hour: number; total: number }[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000; // UTC+7
  const dayStart = new Date(`${date}T00:00:00+07:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("orders")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", dayStart.toISOString())
    .lt("created_at", dayEnd.toISOString());

  const byHour = new Map<number, number>();
  for (const row of (data ?? []) as { created_at: string; total: number }[]) {
    const bkkHour = new Date(
      new Date(row.created_at).getTime() + offsetMs
    ).getUTCHours();
    byHour.set(bkkHour, (byHour.get(bkkHour) ?? 0) + Number(row.total));
  }

  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    total: byHour.get(h) ?? 0,
  }));
}

export async function getSalesByCategory(
  tenantId: string,
  range: "day" | "week" | "month"
): Promise<{ category: string; total: number }[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const now = new Date();
  const bangkokNow = new Date(now.getTime() + offsetMs);

  let rangeStart: Date;
  if (range === "day") {
    const midnight = Date.UTC(
      bangkokNow.getUTCFullYear(),
      bangkokNow.getUTCMonth(),
      bangkokNow.getUTCDate()
    );
    rangeStart = new Date(midnight - offsetMs);
  } else if (range === "week") {
    rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString());

  if (!orders || orders.length === 0) return [];

  const orderIds = (orders as { id: string }[]).map((o) => o.id);

  const { data: items } = await supabase
    .from("order_items")
    .select("category_name, subtotal")
    .in("order_id", orderIds);

  const byCategory = new Map<string, number>();
  for (const item of (items ?? []) as {
    category_name: string | null;
    subtotal: number;
  }[]) {
    const cat = item.category_name ?? "ไม่มีหมวดหมู่";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + Number(item.subtotal));
  }

  return [...byCategory.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}
