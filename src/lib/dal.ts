import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ModifierWithOptions, ProductCost, LowStockAlert } from "@/types/app";

export type Role = "owner" | "manager" | "staff";

export type { LowStockAlert, ProductCost };

export type ProfileWithTenant = {
  id: string;
  full_name: string | null;
  role: Role;
  tenant_id: string;
  pin_hash: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
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

export async function getProductCost(tenantId: string, productId: string): Promise<ProductCost> {
  const supabase = await createClient();

  // Verify product belongs to this tenant
  const { data: productCheck } = await supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .single();

  if (!productCheck) return { productId, ingredientCost: 0, recipes: [] };

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
  range: "day" | "week" | "month" | "year" | "custom",
  customRange?: { start: string; end: string } // "YYYY-MM-DD" Bangkok, required when range === "custom"
): Promise<{ category: string; total: number }[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const now = new Date();
  const bangkokNow = new Date(now.getTime() + offsetMs);

  let rangeStart: Date;
  let rangeEndExclusive: Date | null = null;
  if (range === "custom" && customRange) {
    rangeStart = new Date(`${customRange.start}T00:00:00+07:00`);
    rangeEndExclusive = new Date(`${customRange.end}T00:00:00+07:00`);
    rangeEndExclusive.setTime(rangeEndExclusive.getTime() + 24 * 60 * 60 * 1000);
  } else if (range === "day") {
    const midnight = Date.UTC(
      bangkokNow.getUTCFullYear(),
      bangkokNow.getUTCMonth(),
      bangkokNow.getUTCDate()
    );
    rangeStart = new Date(midnight - offsetMs);
  } else if (range === "week") {
    rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === "month") {
    rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    // year — ตั้งแต่ 1 ม.ค. ของปีนี้ตาม Bangkok time
    rangeStart = new Date(`${bangkokNow.getUTCFullYear()}-01-01T00:00:00+07:00`);
  }

  let query = supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString());
  if (rangeEndExclusive) {
    query = query.lt("created_at", rangeEndExclusive.toISOString());
  }
  const { data: orders } = await query;

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

// ─── Analytics Types ─────────────────────────────────────────────────────────

export type SalesByDay = { date: string; total: number };
export type SalesByMonth = { month: number; total: number };
export type HourlyPattern = { hour: number; total: number };
export type SalesSummary = { totalSales: number; totalOrders: number };

// ─── getSalesByDay ────────────────────────────────────────────────────────────

export async function getSalesByDay(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<SalesByDay[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000); // exclusive

  const { data } = await supabase
    .from("orders")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  const byDate = new Map<string, number>();
  for (const row of (data ?? []) as { created_at: string; total: number }[]) {
    const d = new Date(new Date(row.created_at).getTime() + offsetMs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    byDate.set(key, (byDate.get(key) ?? 0) + Number(row.total));
  }

  const result: SalesByDay[] = [];
  let cursor = new Date(rangeStart);
  while (cursor.getTime() < rangeEnd.getTime()) {
    const d = new Date(cursor.getTime() + offsetMs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    result.push({ date: key, total: byDate.get(key) ?? 0 });
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return result;
}

// ─── getSalesByMonth ──────────────────────────────────────────────────────────

export async function getSalesByMonth(
  tenantId: string,
  year: number // Bangkok calendar year
): Promise<SalesByMonth[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const yearStart = new Date(`${year}-01-01T00:00:00+07:00`);
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00+07:00`);

  const { data } = await supabase
    .from("orders")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", yearStart.toISOString())
    .lt("created_at", yearEnd.toISOString());

  const byMonth = new Map<number, number>();
  for (const row of (data ?? []) as { created_at: string; total: number }[]) {
    const m = new Date(new Date(row.created_at).getTime() + offsetMs).getUTCMonth() + 1;
    byMonth.set(m, (byMonth.get(m) ?? 0) + Number(row.total));
  }

  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    total: byMonth.get(i + 1) ?? 0,
  }));
}

// ─── getHourlyPattern ─────────────────────────────────────────────────────────

export async function getHourlyPattern(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<HourlyPattern[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("orders")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  const byHour = new Map<number, number>();
  for (const row of (data ?? []) as { created_at: string; total: number }[]) {
    const h = new Date(new Date(row.created_at).getTime() + offsetMs).getUTCHours();
    byHour.set(h, (byHour.get(h) ?? 0) + Number(row.total));
  }

  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    total: byHour.get(h) ?? 0,
  }));
}

// ─── getSalesSummary ──────────────────────────────────────────────────────────

export async function getSalesSummary(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<SalesSummary> {
  const supabase = await createClient();
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("orders")
    .select("total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  const rows = (data ?? []) as { total: number }[];
  return {
    totalSales: rows.reduce((sum, r) => sum + Number(r.total), 0),
    totalOrders: rows.length,
  };
}

// ─── Calculator Helpers ───────────────────────────────────────────────────────

export type CalcProduct = { id: string; name: string };

export async function getProductsForCalculator(
  tenantId: string
): Promise<CalcProduct[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as CalcProduct[];
}

export async function getTenantDeliveryGp(tenantId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("delivery_gp_percent")
    .eq("id", tenantId)
    .single();
  const row = data as { delivery_gp_percent: number | null } | null;
  return row?.delivery_gp_percent ?? 30;
}

// ─── PromptPay ───────────────────────────────────────────────────────────────

export async function getTenantPromptPayId(tenantId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("promptpay_id")
    .eq("id", tenantId)
    .single();
  const row = data as { promptpay_id: string | null } | null;
  return row?.promptpay_id ?? null;
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

export type Shift = {
  id: string;
  openedAt: string;
  openingCash: number;
  status: "open" | "closed";
};

export type ShiftSummary = {
  totalCash: number;
  totalTransfer: number;
  totalCard: number;
  orderCount: number;
  expectedCash: number;
};

export async function getActiveShift(tenantId: string): Promise<Shift | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shifts")
    .select("id, opened_at, opening_cash, status")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    openedAt: data.opened_at,
    openingCash: Number(data.opening_cash),
    status: "open",
  };
}

export async function getShiftSummary(
  tenantId: string,
  shiftId: string
): Promise<ShiftSummary> {
  const supabase = await createClient();
  const { data: orderRows } = await supabase
    .from("orders")
    .select("total, payment_method")
    .eq("tenant_id", tenantId)
    .eq("shift_id", shiftId)
    .neq("status", "cancelled");

  const rows = (orderRows ?? []) as { total: number; payment_method: string }[];
  const totalCash = rows
    .filter((r) => r.payment_method === "cash")
    .reduce((sum, r) => sum + Number(r.total), 0);
  const totalTransfer = rows
    .filter((r) => r.payment_method === "transfer")
    .reduce((sum, r) => sum + Number(r.total), 0);
  const totalCard = rows
    .filter((r) => r.payment_method === "card")
    .reduce((sum, r) => sum + Number(r.total), 0);

  const { data: shiftRow } = await supabase
    .from("shifts")
    .select("opening_cash")
    .eq("id", shiftId)
    .eq("tenant_id", tenantId)
    .single();
  const openingCash = Number(
    (shiftRow as { opening_cash: number } | null)?.opening_cash ?? 0
  );

  return {
    totalCash,
    totalTransfer,
    totalCard,
    orderCount: rows.length,
    expectedCash: openingCash + totalCash,
  };
}

// ─── Customer History ────────────────────────────────────────────────────────

export type CustomerListItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
};

export type CustomerOrderHistoryItem = {
  id: string;
  orderNumber: string | null;
  createdAt: string;
  total: number;
  paymentMethod: string;
  status: string;
};

export async function getCustomers(tenantId: string): Promise<CustomerListItem[]> {
  const supabase = await createClient();

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .eq("tenant_id", tenantId);

  const { data: orderRows } = await supabase
    .from("orders")
    .select("customer_id, total, created_at")
    .eq("tenant_id", tenantId)
    .not("customer_id", "is", null)
    .neq("status", "cancelled");

  type OrderAggRow = { customer_id: string | null; total: number; created_at: string };
  const byCustomer = new Map<string, { count: number; spent: number; last: string }>();
  for (const row of (orderRows ?? []) as OrderAggRow[]) {
    if (!row.customer_id) continue;
    const existing = byCustomer.get(row.customer_id);
    if (existing) {
      existing.count += 1;
      existing.spent += Number(row.total);
      if (row.created_at > existing.last) existing.last = row.created_at;
    } else {
      byCustomer.set(row.customer_id, {
        count: 1,
        spent: Number(row.total),
        last: row.created_at,
      });
    }
  }

  type CustomerRow = { id: string; name: string; phone: string | null; email: string | null };
  const result: CustomerListItem[] = ((customerRows ?? []) as CustomerRow[]).map((c) => {
    const agg = byCustomer.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      orderCount: agg?.count ?? 0,
      totalSpent: agg?.spent ?? 0,
      lastOrderAt: agg?.last ?? null,
    };
  });

  return result.sort((a, b) => b.totalSpent - a.totalSpent);
}

export async function getCustomerById(
  tenantId: string,
  customerId: string
): Promise<CustomerListItem | null> {
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .single();
  if (!customer) return null;

  const { data: orderRows } = await supabase
    .from("orders")
    .select("total, created_at")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .neq("status", "cancelled");

  const rows = (orderRows ?? []) as { total: number; created_at: string }[];
  const totalSpent = rows.reduce((sum, r) => sum + Number(r.total), 0);
  let lastOrderAt: string | null = null;
  for (const row of rows) {
    if (lastOrderAt === null || row.created_at > lastOrderAt) {
      lastOrderAt = row.created_at;
    }
  }

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    orderCount: rows.length,
    totalSpent,
    lastOrderAt,
  };
}

export async function getCustomerOrders(
  tenantId: string,
  customerId: string
): Promise<CustomerOrderHistoryItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, order_number, created_at, total, payment_method, status")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    order_number: string | null;
    created_at: string;
    total: number;
    payment_method: string;
    status: string;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    createdAt: r.created_at,
    total: Number(r.total),
    paymentMethod: r.payment_method,
    status: r.status,
  }));
}
