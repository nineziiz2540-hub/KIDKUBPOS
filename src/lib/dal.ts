import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ModifierWithOptions, ProductCost, LowStockAlert } from "@/types/app";
import { UNCATEGORIZED_LABEL } from "@/lib/dashboard-labels";

// Re-exported so existing server-side callers can keep importing this
// constant from dal.ts. Client components must import it from
// "@/lib/dashboard-labels" directly, NOT from here — this file has
// `import "server-only"` above and cannot be imported by "use client" code.
export { UNCATEGORIZED_LABEL };

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
  has_backup_password: boolean;
  deactivated_at: string | null;
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

  if (!data || (data as ProfileWithTenant).deactivated_at !== null) return null;

  return data as ProfileWithTenant;
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

  const [today, yesterday] = await Promise.all([
    getOrdersInRange(supabase, tenantId, todayStart, tomorrowStart),
    getOrdersInRange(supabase, tenantId, yesterdayStart, todayStart),
  ]);

  return {
    todaySales: today.reduce((sum, r) => sum + Number(r.total), 0),
    todayOrders: today.length,
    yesterdaySales: yesterday.reduce((sum, r) => sum + Number(r.total), 0),
    yesterdayOrders: yesterday.length,
  };
}

export type SoldUnit = "แก้ว" | "ชิ้น" | "ขวด";

const DRINK_KEYWORDS = [
  "coffee", "กาแฟ", "matcha", "มัทฉะ", "tea", "ชา",
  "non-coffee", "non coffee", "noncoffee",
];
const BAKERY_KEYWORDS = ["bakery", "เบเกอรี่", "ขนม", "cake", "เค้ก"];

export function classifyUnit(categoryName: string | null): SoldUnit {
  if (!categoryName) return "ขวด";
  const lower = categoryName.toLowerCase();
  if (DRINK_KEYWORDS.some((k) => lower.includes(k))) return "แก้ว";
  if (BAKERY_KEYWORDS.some((k) => lower.includes(k))) return "ชิ้น";
  return "ขวด";
}

/**
 * Converts an inclusive Bangkok-local ["YYYY-MM-DD", "YYYY-MM-DD"] date range
 * into the [start, end) UTC instant range used by `.gte()/.lt()` queries.
 */
function bangkokRange(startDate: string, endDate: string): { rangeStart: Date; rangeEnd: Date } {
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);
  return { rangeStart, rangeEnd };
}

type OrderItemRangeRow = {
  product_id: string | null;
  product_name: string;
  category_name: string | null;
  quantity: number;
  subtotal: number;
};

const DB_PAGE_SIZE = 1000;

/**
 * Fetches every order_items row for a tenant within a Bangkok-local date
 * range in one query, joining directly to `orders` (`orders!inner(...)`)
 * instead of first fetching order ids and re-querying with `.in()`. That
 * two-step shape silently drops orders past PostgREST's default row cap
 * before order_items is even queried — a real risk once a tenant has more
 * orders in a period than the cap (e.g. a busy café's yearly view). Joining
 * directly removes that intermediate truncation point, and paginating with
 * `.range()` here removes the remaining one so this never silently drops
 * rows regardless of order volume.
 */
async function getOrderItemsInRange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<OrderItemRangeRow[]> {
  type RawRow = OrderItemRangeRow & { orders: unknown };
  const rows: OrderItemRangeRow[] = [];

  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("order_items")
      .select(
        "product_id, product_name, category_name, quantity, subtotal, orders!inner(tenant_id, status, created_at)"
      )
      .eq("orders.tenant_id", tenantId)
      .neq("orders.status", "cancelled")
      .neq("orders.status", "refunded")
      .gte("orders.created_at", rangeStart.toISOString())
      .lt("orders.created_at", rangeEnd.toISOString())
      .range(from, from + DB_PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data ?? []) as unknown as RawRow[];
    for (const row of page) {
      rows.push({
        product_id: row.product_id,
        product_name: row.product_name,
        category_name: row.category_name,
        quantity: row.quantity,
        subtotal: row.subtotal,
      });
    }
    if (page.length < DB_PAGE_SIZE) break;
  }

  return rows;
}

type OrderRangeRow = { created_at: string; total: number; payment_method: string };

/**
 * Fetches every `orders` row for a tenant within a date range, paginating
 * with `.range()` until every matching row is collected — a plain
 * `.select()` here is capped at PostgREST's default row limit with no error
 * surfaced, the same silent-truncation risk `getOrderItemsInRange` fixes for
 * order_items. Selects the small superset of columns (`created_at`, `total`,
 * `payment_method`) every caller in this file needs so they can all share
 * one paginated fetch instead of duplicating the loop.
 */
async function getOrdersInRange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<OrderRangeRow[]> {
  const rows: OrderRangeRow[] = [];

  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("orders")
      .select("created_at, total, payment_method")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .neq("status", "refunded")
      .gte("created_at", rangeStart.toISOString())
      .lt("created_at", rangeEnd.toISOString())
      .range(from, from + DB_PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data ?? []) as unknown as OrderRangeRow[];
    rows.push(...page);
    if (page.length < DB_PAGE_SIZE) break;
  }

  return rows;
}

export type TopProduct = {
  product_name: string;
  total_qty: number;
  total_sales: number;
  unit: SoldUnit;
};

export async function getTopProducts(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string,   // "YYYY-MM-DD" Bangkok (inclusive)
  limit = 5
): Promise<TopProduct[]> {
  const supabase = await createClient();
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const items = await getOrderItemsInRange(supabase, tenantId, rangeStart, rangeEnd);

  if (items.length === 0) return [];

  const map = new Map<
    string,
    { total_qty: number; total_sales: number; category_name: string | null }
  >();
  for (const row of items) {
    const prev = map.get(row.product_name) ?? {
      total_qty: 0,
      total_sales: 0,
      category_name: row.category_name,
    };
    map.set(row.product_name, {
      total_qty: prev.total_qty + row.quantity,
      total_sales: prev.total_sales + Number(row.subtotal),
      category_name: prev.category_name ?? row.category_name,
    });
  }

  return [...map.entries()]
    .map(([product_name, s]) => ({
      product_name,
      total_qty: s.total_qty,
      total_sales: s.total_sales,
      unit: classifyUnit(s.category_name),
    }))
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, limit);
}

export type TeamMember = {
  id: string;
  full_name: string | null;
  role: Role;
  created_at: string;
  deactivated_at: string | null;
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
    .select("id, full_name, role, created_at, deactivated_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  return (data ?? []) as TeamMember[];
}

export async function getTeamMembersByRole(
  tenantId: string,
  role: Role,
  excludeId?: string
): Promise<Pick<TeamMember, "id" | "full_name">[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("role", role)
    .is("deactivated_at", null);
  if (excludeId) {
    query = query.neq("id", excludeId);
  }
  const { data } = await query.order("full_name", { ascending: true });
  return (data ?? []) as Pick<TeamMember, "id" | "full_name">[];
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

  const orders = await getOrdersInRange(supabase, tenantId, dayStart, dayEnd);

  const byHour = new Map<number, number>();
  for (const row of orders) {
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
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<{ category: string; total: number }[]> {
  const supabase = await createClient();
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const items = await getOrderItemsInRange(supabase, tenantId, rangeStart, rangeEnd);

  const byCategory = new Map<string, number>();
  for (const item of items) {
    const cat = item.category_name ?? UNCATEGORIZED_LABEL;
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
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const orders = await getOrdersInRange(supabase, tenantId, rangeStart, rangeEnd);

  const byDate = new Map<string, number>();
  for (const row of orders) {
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

  const orders = await getOrdersInRange(supabase, tenantId, yearStart, yearEnd);

  const byMonth = new Map<number, number>();
  for (const row of orders) {
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
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const orders = await getOrdersInRange(supabase, tenantId, rangeStart, rangeEnd);

  const byHour = new Map<number, number>();
  for (const row of orders) {
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
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const orders = await getOrdersInRange(supabase, tenantId, rangeStart, rangeEnd);

  return {
    totalSales: orders.reduce((sum, r) => sum + Number(r.total), 0),
    totalOrders: orders.length,
  };
}

// ─── Cost & Profit ────────────────────────────────────────────────────────────

export type CostProfitSummary = {
  revenue: number;
  cogs: number;
  fixedCostShare: number;
  totalCost: number;
  profit: number;
  hasUnrecipedItems: boolean;
};

/**
 * Batch-computes each product's unit cost (sum of recipe line costs) for a
 * set of product ids in a single query. `missing` holds the ids that had no
 * recipe rows at all — callers decide how to treat that (e.g. flag it, or
 * treat it as ฿0 cost) rather than this helper deciding for them.
 */
async function unitCostByProductId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  productIds: string[]
): Promise<{ costs: Map<string, number>; missing: Set<string> }> {
  const costs = new Map<string, number>();
  if (productIds.length === 0) return { costs, missing: new Set() };

  const { data: recipeRows } = await supabase
    .from("product_recipes")
    .select("product_id, quantity_used, raw_materials(cost_per_unit)")
    .in("product_id", productIds);

  type RecipeRow = {
    product_id: string;
    quantity_used: number;
    raw_materials: { cost_per_unit: number } | null;
  };
  for (const r of (recipeRows ?? []) as RecipeRow[]) {
    if (!r.raw_materials) continue;
    const lineCost = Number(r.quantity_used) * Number(r.raw_materials.cost_per_unit);
    costs.set(r.product_id, (costs.get(r.product_id) ?? 0) + lineCost);
  }

  const missing = new Set(productIds.filter((id) => !costs.has(id)));
  return { costs, missing };
}

export async function getCostProfit(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string,   // "YYYY-MM-DD" Bangkok (inclusive)
  daysInPeriod: number
): Promise<CostProfitSummary> {
  const supabase = await createClient();
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("fixed_cost_monthly")
    .eq("id", tenantId)
    .single();
  const fixedCostMonthly = Number(
    (tenantRow as { fixed_cost_monthly: number } | null)?.fixed_cost_monthly ?? 0
  );
  const fixedCostShare = (fixedCostMonthly / 30) * daysInPeriod;

  const orderRows = await getOrdersInRange(supabase, tenantId, rangeStart, rangeEnd);
  const revenue = orderRows.reduce((sum, r) => sum + Number(r.total), 0);

  if (orderRows.length === 0) {
    return {
      revenue: 0,
      cogs: 0,
      fixedCostShare,
      totalCost: fixedCostShare,
      profit: -fixedCostShare,
      hasUnrecipedItems: false,
    };
  }

  const items = await getOrderItemsInRange(supabase, tenantId, rangeStart, rangeEnd);

  const qtyByProduct = new Map<string, number>();
  for (const item of items) {
    if (!item.product_id) continue;
    qtyByProduct.set(item.product_id, (qtyByProduct.get(item.product_id) ?? 0) + item.quantity);
  }
  const productIds = [...qtyByProduct.keys()];

  const { costs: costPerProduct, missing } = await unitCostByProductId(supabase, productIds);

  let cogs = 0;
  for (const [productId, qty] of qtyByProduct) {
    const unitCost = costPerProduct.get(productId);
    if (unitCost === undefined) continue;
    cogs += unitCost * qty;
  }
  const hasUnrecipedItems = missing.size > 0;

  const totalCost = cogs + fixedCostShare;

  return {
    revenue,
    cogs,
    fixedCostShare,
    totalCost,
    profit: revenue - totalCost,
    hasUnrecipedItems,
  };
}

// ─── Payment Method Breakdown ───────────────────────────────────────────────────

export async function getPaymentMethodBreakdown(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<{ cash: number; transfer: number }> {
  const supabase = await createClient();
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const orders = await getOrdersInRange(supabase, tenantId, rangeStart, rangeEnd);

  return {
    cash: orders.filter((r) => r.payment_method === "cash").reduce((sum, r) => sum + Number(r.total), 0),
    transfer: orders
      .filter((r) => r.payment_method === "transfer")
      .reduce((sum, r) => sum + Number(r.total), 0),
  };
}

// ─── Sales Quantity Summary ─────────────────────────────────────────────────

export type CategoryQty = { category: string; unit: SoldUnit; qty: number };

export async function getSalesQuantitySummary(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<CategoryQty[]> {
  const supabase = await createClient();
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const items = await getOrderItemsInRange(supabase, tenantId, rangeStart, rangeEnd);

  const byCategory = new Map<string, number>();
  for (const item of items) {
    const cat = item.category_name ?? UNCATEGORIZED_LABEL;
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + item.quantity);
  }

  return [...byCategory.entries()]
    .map(([category, qty]) => ({
      category,
      unit: classifyUnit(category),
      qty,
    }))
    .sort((a, b) => b.qty - a.qty);
}

// ─── Per-Menu Profit ─────────────────────────────────────────────────────────

export type MenuProfitRow = {
  productName: string;
  qty: number;
  unit: SoldUnit;
  revenue: number;
  cost: number;
  profit: number;
  gpPercent: number;
};

export async function getMenuProfitBreakdown(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<MenuProfitRow[]> {
  const supabase = await createClient();
  const { rangeStart, rangeEnd } = bangkokRange(startDate, endDate);

  const items = await getOrderItemsInRange(supabase, tenantId, rangeStart, rangeEnd);

  const byProduct = new Map<
    string,
    { productId: string | null; category_name: string | null; qty: number; revenue: number }
  >();
  for (const row of items) {
    const prev = byProduct.get(row.product_name) ?? {
      productId: row.product_id,
      category_name: row.category_name,
      qty: 0,
      revenue: 0,
    };
    byProduct.set(row.product_name, {
      productId: prev.productId ?? row.product_id,
      category_name: prev.category_name ?? row.category_name,
      qty: prev.qty + row.quantity,
      revenue: prev.revenue + Number(row.subtotal),
    });
  }

  const productIds = [...byProduct.values()]
    .map((v) => v.productId)
    .filter((id): id is string => id !== null);

  const { costs: unitCostMap } = await unitCostByProductId(supabase, productIds);

  return [...byProduct.entries()]
    .map(([productName, v]) => {
      const unitCost = v.productId ? unitCostMap.get(v.productId) ?? 0 : 0;
      const cost = unitCost * v.qty;
      const profit = v.revenue - cost;
      return {
        productName,
        qty: v.qty,
        unit: classifyUnit(v.category_name),
        revenue: v.revenue,
        cost,
        profit,
        gpPercent: v.revenue > 0 ? (profit / v.revenue) * 100 : 0,
      };
    })
    .sort((a, b) => b.qty - a.qty);
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
  totalCashRefunded: number;
  totalTransfer: number;
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
  // Deliberately NOT excluding 'refunded' here: the cash from a later-refunded order's original
  // sale genuinely entered this shift's drawer historically. The refund's cash outflow is
  // subtracted separately below, tagged to whichever shift the refund itself happened in
  // (refund_shift_id) — which may differ from this shift. Excluding 'refunded' here too would
  // double-subtract when the refund happens in the same shift as its original sale.

  const rows = (orderRows ?? []) as { total: number; payment_method: string }[];
  const totalCashGross = rows
    .filter((r) => r.payment_method === "cash")
    .reduce((sum, r) => sum + Number(r.total), 0);
  const totalTransfer = rows
    .filter((r) => r.payment_method === "transfer")
    .reduce((sum, r) => sum + Number(r.total), 0);

  const { data: refundRows } = await supabase
    .from("orders")
    .select("total")
    .eq("tenant_id", tenantId)
    .eq("refund_shift_id", shiftId)
    .eq("status", "refunded")
    .eq("refund_method", "cash");
  const totalCashRefunded = ((refundRows ?? []) as { total: number }[]).reduce(
    (sum, r) => sum + Number(r.total),
    0
  );

  const { data: shiftRow } = await supabase
    .from("shifts")
    .select("opening_cash")
    .eq("id", shiftId)
    .eq("tenant_id", tenantId)
    .single();
  const openingCash = Number(
    (shiftRow as { opening_cash: number } | null)?.opening_cash ?? 0
  );

  const totalCash = totalCashGross - totalCashRefunded;

  return {
    totalCash,
    totalCashRefunded,
    totalTransfer,
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
    .neq("status", "cancelled")
    .neq("status", "refunded");

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
    .neq("status", "cancelled")
    .neq("status", "refunded");

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
