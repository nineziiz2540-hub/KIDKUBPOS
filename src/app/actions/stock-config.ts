"use server";
// Owner/manager setup for choice groups (bean / matcha / sweetener) and the shop sweetness table
// (round D1, Task 11). Writes go through the user client (RLS); on top of that EVERY referenced id is
// checked against the caller's tenant here, because the DB-side cross-tenant guard lands at deploy.
// The tenant always comes from the profile, never from the caller's arguments.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import {
  validateGroupMembers,
  validateSweetnessLevels,
  validateSweetnessAmount,
  type GroupKind,
} from "@/lib/stock/config-validate";
import { missingSeedGroups, missingSeedLevels, planDefaultSwitch, moveId } from "@/lib/stock/config-plan";
import { removalCheck, nextDefaultAfterRemoval, type RemovalCtx } from "@/lib/stock/member-removal";

export type StockConfigState = { error?: string; success?: boolean };

const NO_RIGHT = "ไม่มีสิทธิ์ดำเนินการนี้";
const BAD_INPUT = "ข้อมูลไม่ถูกต้อง";
const SAVE_FAIL = "บันทึกไม่สำเร็จ — ลองอีกครั้ง";
const DEFAULT_FAIL = "ตั้งค่าเริ่มต้นไม่สำเร็จ — ลองอีกครั้ง";
const REMOVE_FAIL = "นำออกไม่สำเร็จ — ลองอีกครั้ง";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function requireManager() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "owner" && profile.role !== "manager")) return null;
  return profile;
}

function revalidateConfig() {
  revalidatePath("/inventory/groups");
  revalidatePath("/inventory/sweetness");
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

async function loadGroup(supabase: Supabase, tenantId: string, groupId: string) {
  const { data } = await supabase
    .from("choice_groups")
    .select("id, kind")
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ? { id: data.id, kind: data.kind as GroupKind } : null;
}

type MemberRow = {
  id: string;
  group_id: string;
  raw_material_id: string;
  label: string;
  tier: string;
  price_delta: number;
  is_default: boolean;
  sort_order: number;
};
const MEMBER_COLUMNS = "id, group_id, raw_material_id, label, tier, price_delta, is_default, sort_order";

async function loadMembers(supabase: Supabase, tenantId: string, groupId: string): Promise<MemberRow[]> {
  const { data } = await supabase
    .from("choice_group_members")
    .select(MEMBER_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("group_id", groupId)
    .order("sort_order")
    .order("id");
  return ((data ?? []) as MemberRow[]).map((m) => ({ ...m, price_delta: Number(m.price_delta) }));
}

function toInput(m: MemberRow) {
  return {
    materialId: m.raw_material_id,
    label: m.label,
    tier: m.tier === "special" ? ("special" as const) : ("house" as const),
    priceDelta: m.price_delta,
    isDefault: m.is_default,
  };
}

// ── seed ───────────────────────────────────────────────────────────────────

/** "สร้างกลุ่มตั้งต้น" — creates only what is missing, so pressing it twice never duplicates. */
export async function seedStockGroups(): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  const supabase = await createClient();
  const tenantId = profile.tenant_id;

  const [{ data: groups, error: gErr }, { data: levels, error: lErr }] = await Promise.all([
    supabase.from("choice_groups").select("kind, sort_order").eq("tenant_id", tenantId),
    supabase.from("sweetness_levels").select("name, is_none, is_default, sort_order").eq("tenant_id", tenantId),
  ]);
  if (gErr || lErr) return { error: SAVE_FAIL };

  const newGroups = missingSeedGroups(groups ?? []);
  if (newGroups.length > 0) {
    const { error } = await supabase.from("choice_groups").insert(
      newGroups.map((g) => ({ tenant_id: tenantId, kind: g.kind, name: g.name, sort_order: g.sortOrder }))
    );
    if (error) return { error: SAVE_FAIL };
  }
  const newLevels = missingSeedLevels(levels ?? []);
  if (newLevels.length > 0) {
    const { error } = await supabase.from("sweetness_levels").insert(
      newLevels.map((l) => ({
        tenant_id: tenantId,
        name: l.name,
        is_none: l.isNone,
        is_default: l.isDefault,
        sort_order: l.sortOrder,
      }))
    );
    if (error) {
      revalidateConfig();
      return { error: SAVE_FAIL };
    }
  }
  revalidateConfig();
  return { success: true };
}

// ── group members ──────────────────────────────────────────────────────────

export async function addGroupMember(groupId: string, materialId: string): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(groupId) || !isId(materialId)) return { error: BAD_INPUT };
  const supabase = await createClient();
  const tenantId = profile.tenant_id;

  const group = await loadGroup(supabase, tenantId, groupId);
  if (!group) return { error: BAD_INPUT };

  // The material must be this shop's and still in use (not archived).
  const { data: mat } = await createAdminClient()
    .from("raw_materials")
    .select("id, name")
    .eq("id", materialId)
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .maybeSingle();
  if (!mat) return { error: "ไม่พบวัตถุดิบนี้ หรือปิดใช้แล้ว" };

  const existing = await loadMembers(supabase, tenantId, groupId);
  if (existing.some((m) => m.raw_material_id === materialId)) return { error: "วัตถุดิบเดียวกันใส่ซ้ำไม่ได้" };

  const label = String(mat.name).trim().slice(0, 60);
  const isDefault = existing.length === 0;
  const problem = validateGroupMembers(group.kind, [
    ...existing.map(toInput),
    { materialId, label, tier: "house", priceDelta: 0, isDefault },
  ]);
  if (problem) return { error: problem };

  const { error } = await supabase.from("choice_group_members").insert({
    tenant_id: tenantId,
    group_id: groupId,
    raw_material_id: materialId,
    label,
    tier: "house",
    price_delta: 0,
    is_default: isDefault,
    sort_order: existing.reduce((mx, m) => Math.max(mx, m.sort_order), -1) + 1,
  });
  if (error) {
    if (error.code === "23505") {
      // Two first members added at once trip the one-default index; a repeated material trips (group, material).
      if ((error.message ?? "").includes("choice_group_members_one_default")) {
        return { error: "มีค่าเริ่มต้นของกลุ่มนี้แล้ว — ลองอีกครั้ง" };
      }
      return { error: "วัตถุดิบเดียวกันใส่ซ้ำไม่ได้" };
    }
    return { error: SAVE_FAIL };
  }
  revalidateConfig();
  return { success: true };
}

export async function updateGroupMember(
  memberId: string,
  fields: { label: string; tier: "house" | "special"; priceDelta: number }
): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(memberId) || typeof fields?.label !== "string") return { error: BAD_INPUT };
  if (fields.tier !== "house" && fields.tier !== "special") return { error: BAD_INPUT };
  if (typeof fields.priceDelta !== "number") return { error: BAD_INPUT };
  const supabase = await createClient();
  const tenantId = profile.tenant_id;

  const { data: row } = await supabase
    .from("choice_group_members")
    .select(MEMBER_COLUMNS)
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!row) return { error: BAD_INPUT };
  const current = { ...(row as MemberRow), price_delta: Number((row as MemberRow).price_delta) };
  const group = await loadGroup(supabase, tenantId, current.group_id);
  if (!group) return { error: BAD_INPUT };

  const label = fields.label.trim();
  if (label.length > 60) return { error: "ชื่อยาวเกินไป (ไม่เกิน 60 ตัวอักษร)" };
  const priceDelta = fields.tier === "house" ? 0 : fields.priceDelta;
  const problem = validateGroupMembers(group.kind, [
    { ...toInput(current), label, tier: fields.tier, priceDelta },
  ]);
  if (problem) return { error: problem };

  const { error } = await supabase
    .from("choice_group_members")
    .update({ label, tier: fields.tier, price_delta: priceDelta })
    .eq("id", memberId)
    .eq("tenant_id", tenantId);
  if (error) return { error: SAVE_FAIL };
  revalidateConfig();
  return { success: true };
}

export async function setDefaultMember(memberId: string): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(memberId)) return { error: BAD_INPUT };
  const supabase = await createClient();
  const tenantId = profile.tenant_id;

  const { data: row } = await supabase
    .from("choice_group_members")
    .select("id, group_id")
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!row) return { error: BAD_INPUT };
  const siblings = await loadMembers(supabase, tenantId, row.group_id);
  const plan = planDefaultSwitch(
    siblings.map((m) => ({ id: m.id, isDefault: m.is_default })),
    memberId
  );
  if (!plan) return { error: BAD_INPUT };

  // Clear the old default first (one default per group is a unique index), then set the new one.
  if (plan.clearIds.length > 0) {
    const { error } = await supabase
      .from("choice_group_members")
      .update({ is_default: false })
      .eq("tenant_id", tenantId)
      .eq("group_id", row.group_id)
      .in("id", plan.clearIds);
    if (error) return { error: DEFAULT_FAIL };
  }
  if (plan.setId) {
    const { error } = await supabase
      .from("choice_group_members")
      .update({ is_default: true })
      .eq("id", plan.setId)
      .eq("tenant_id", tenantId);
    if (error) {
      revalidateConfig(); // the old default is already cleared — show the real state
      return { error: DEFAULT_FAIL };
    }
  }
  revalidateConfig();
  return { success: true };
}

export async function moveGroupMember(memberId: string, dir: number): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(memberId) || (dir !== -1 && dir !== 1)) return { error: BAD_INPUT };
  const supabase = await createClient();
  const tenantId = profile.tenant_id;

  const { data: row } = await supabase
    .from("choice_group_members")
    .select("id, group_id")
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!row) return { error: BAD_INPUT };
  const siblings = await loadMembers(supabase, tenantId, row.group_id);
  const reordered = moveId(
    siblings.map((m) => m.id),
    memberId,
    dir
  );
  for (let i = 0; i < reordered.length; i++) {
    const m = siblings.find((s) => s.id === reordered[i])!;
    if (m.sort_order === i) continue;
    const { error } = await supabase
      .from("choice_group_members")
      .update({ sort_order: i })
      .eq("id", m.id)
      .eq("tenant_id", tenantId);
    if (error) {
      revalidateConfig();
      return { error: SAVE_FAIL };
    }
  }
  revalidateConfig();
  return { success: true };
}

// ── remove a member (R38) ──────────────────────────────────────────────────

export type RemovalCheckState = { error?: string; blocked?: string; warn?: string | null };

/**
 * Loads everything the removal rules need. Reads of menus go through the admin client AFTER the role check
 * (so a policy can never hide a reference and let a removal through), always filtered by the caller's tenant;
 * the member, its group and every menu read are tenant-checked as in R37.
 */
async function loadRemovalContext(tenantId: string, memberId: string) {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("choice_group_members")
    .select("id, group_id")
    .eq("id", memberId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!row) return null;
  const group = await loadGroup(supabase, tenantId, row.group_id);
  if (!group) return null;
  const members = await loadMembers(supabase, tenantId, group.id);
  if (!members.some((m) => m.id === memberId)) return null;

  const admin = createAdminClient();
  const [{ data: sw, error: swErr }, { data: slots, error: slotErr }] = await Promise.all([
    admin
      .from("product_sweetness")
      .select("default_member_id, allowed_member_ids, products(name)")
      .eq("tenant_id", tenantId)
      .eq("group_id", group.id),
    admin
      .from("product_recipes")
      .select("default_member_id, products!inner(name, archived_at)")
      .eq("tenant_id", tenantId)
      .eq("line_kind", "slot")
      .eq("group_id", group.id)
      .is("products.archived_at", null),
  ]);
  if (swErr || slotErr) return null;

  const menuName = (p: unknown) => {
    const prod = Array.isArray(p) ? p[0] : p;
    return String((prod as { name?: string } | null)?.name ?? "").trim() || "เมนู";
  };
  const ctx: RemovalCtx = {
    members: members.map((m) => ({
      id: m.id,
      tier: m.tier === "special" ? "special" : "house",
      sortOrder: m.sort_order,
      isDefault: m.is_default,
    })),
    // Archived menus count here: the sweetness row still points at the member, and the database would refuse.
    sweetnessUses: (sw ?? []).map((r) => ({
      menuName: menuName(r.products),
      defaultMemberId: r.default_member_id,
      allowedMemberIds: (r.allowed_member_ids ?? []) as string[],
    })),
    slotDefaults: (slots ?? []).map((r) => ({
      menuName: menuName(r.products),
      defaultMemberId: r.default_member_id,
    })),
  };
  return { ctx, supabase };
}

/** First tap on "นำออกจากกลุ่ม": says whether the member can go, and what to warn about. Writes nothing. */
export async function checkGroupMemberRemoval(memberId: string): Promise<RemovalCheckState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(memberId)) return { error: BAD_INPUT };
  const loaded = await loadRemovalContext(profile.tenant_id, memberId);
  if (!loaded) return { error: BAD_INPUT };
  const check = removalCheck(memberId, loaded.ctx);
  return check.ok ? { warn: check.warn } : { blocked: check.reason };
}

export async function removeGroupMember(memberId: string): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(memberId)) return { error: BAD_INPUT };
  const tenantId = profile.tenant_id;

  const loaded = await loadRemovalContext(tenantId, memberId);
  if (!loaded) return { error: BAD_INPUT };
  const { ctx, supabase } = loaded;
  // Never trust the client's check: the rules run again here. A warning is the client's second tap.
  const check = removalCheck(memberId, ctx);
  if (!check.ok) return { error: check.reason };

  // 1) the flagged default moves first, so the group is never left without one (the unique index allows one).
  const nextDefault = nextDefaultAfterRemoval(ctx.members, memberId);
  if (nextDefault) {
    const { error: clearErr } = await supabase
      .from("choice_group_members")
      .update({ is_default: false })
      .eq("id", memberId)
      .eq("tenant_id", tenantId);
    if (clearErr) return { error: REMOVE_FAIL };
    const { error: setErr } = await supabase
      .from("choice_group_members")
      .update({ is_default: true })
      .eq("id", nextDefault)
      .eq("tenant_id", tenantId);
    if (setErr) {
      revalidateConfig();
      return { error: REMOVE_FAIL };
    }
  }

  // 2) delete. Menu recipe defaults pointing here are cleared by the FK (product_recipes.default_member_id is
  // ON DELETE SET NULL), and the menu then falls back to the group default; this member's own sweetness
  // amounts go with it (sweetness_amounts.member_id is ON DELETE CASCADE). product_sweetness.default_member_id
  // has no ON DELETE, so the database itself refuses a member a menu's sweetness still uses (23503).
  const { error } = await supabase
    .from("choice_group_members")
    .delete()
    .eq("id", memberId)
    .eq("tenant_id", tenantId);
  if (error) {
    revalidateConfig();
    return { error: error.code === "23503" ? "ใช้อยู่ในความหวานของเมนู — นำออกไม่ได้" : REMOVE_FAIL };
  }
  revalidateConfig();
  return { success: true };
}

// ── sweetness levels ───────────────────────────────────────────────────────

type LevelRow = { id: string; name: string; is_none: boolean; is_default: boolean; sort_order: number };

async function loadLevels(supabase: Supabase, tenantId: string): Promise<LevelRow[]> {
  const { data } = await supabase
    .from("sweetness_levels")
    .select("id, name, is_none, is_default, sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order")
    .order("id");
  return (data ?? []) as LevelRow[];
}

const toLevelInput = (l: LevelRow) => ({ name: l.name, isNone: l.is_none, isDefault: l.is_default });

export async function addSweetnessLevel(name: string): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (typeof name !== "string") return { error: BAD_INPUT };
  const supabase = await createClient();
  const tenantId = profile.tenant_id;
  const clean = name.trim();
  if (clean.length > 40) return { error: "ชื่อระดับยาวเกินไป (ไม่เกิน 40 ตัวอักษร)" };

  const levels = await loadLevels(supabase, tenantId);
  const problem = validateSweetnessLevels([
    ...levels.map(toLevelInput),
    { name: clean, isNone: false, isDefault: false },
  ]);
  if (problem) return { error: problem };

  const { error } = await supabase.from("sweetness_levels").insert({
    tenant_id: tenantId,
    name: clean,
    is_none: false,
    is_default: false,
    sort_order: levels.reduce((mx, l) => Math.max(mx, l.sort_order), -1) + 1,
  });
  if (error) return { error: SAVE_FAIL };
  revalidateConfig();
  return { success: true };
}

export async function updateSweetnessLevel(
  levelId: string,
  fields: { name: string; isNone: boolean }
): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(levelId) || typeof fields?.name !== "string" || typeof fields.isNone !== "boolean") {
    return { error: BAD_INPUT };
  }
  const supabase = await createClient();
  const tenantId = profile.tenant_id;
  const clean = fields.name.trim();
  if (clean.length > 40) return { error: "ชื่อระดับยาวเกินไป (ไม่เกิน 40 ตัวอักษร)" };

  const levels = await loadLevels(supabase, tenantId);
  if (!levels.some((l) => l.id === levelId)) return { error: BAD_INPUT };
  const next = levels.map((l) =>
    l.id === levelId
      ? { name: clean, isNone: fields.isNone, isDefault: l.is_default }
      : { name: l.name, isNone: fields.isNone ? false : l.is_none, isDefault: l.is_default }
  );
  const problem = validateSweetnessLevels(next);
  if (problem) return { error: problem };

  // Making this the ไม่หวาน level moves the flag off any other level (at most one).
  if (fields.isNone) {
    const { error } = await supabase
      .from("sweetness_levels")
      .update({ is_none: false })
      .eq("tenant_id", tenantId)
      .eq("is_none", true)
      .neq("id", levelId);
    if (error) return { error: SAVE_FAIL };
  }
  const { error } = await supabase
    .from("sweetness_levels")
    .update({ name: clean, is_none: fields.isNone })
    .eq("id", levelId)
    .eq("tenant_id", tenantId);
  if (error) {
    revalidateConfig();
    return { error: SAVE_FAIL };
  }
  revalidateConfig();
  return { success: true };
}

export async function setDefaultLevel(levelId: string): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(levelId)) return { error: BAD_INPUT };
  const supabase = await createClient();
  const tenantId = profile.tenant_id;

  const levels = await loadLevels(supabase, tenantId);
  const plan = planDefaultSwitch(
    levels.map((l) => ({ id: l.id, isDefault: l.is_default })),
    levelId
  );
  if (!plan) return { error: BAD_INPUT };

  if (plan.clearIds.length > 0) {
    const { error } = await supabase
      .from("sweetness_levels")
      .update({ is_default: false })
      .eq("tenant_id", tenantId)
      .in("id", plan.clearIds);
    if (error) return { error: DEFAULT_FAIL };
  }
  if (plan.setId) {
    const { error } = await supabase
      .from("sweetness_levels")
      .update({ is_default: true })
      .eq("id", plan.setId)
      .eq("tenant_id", tenantId);
    if (error) {
      revalidateConfig();
      return { error: DEFAULT_FAIL };
    }
  }
  revalidateConfig();
  return { success: true };
}

export async function moveSweetnessLevel(levelId: string, dir: number): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(levelId) || (dir !== -1 && dir !== 1)) return { error: BAD_INPUT };
  const supabase = await createClient();
  const tenantId = profile.tenant_id;

  const levels = await loadLevels(supabase, tenantId);
  if (!levels.some((l) => l.id === levelId)) return { error: BAD_INPUT };
  const reordered = moveId(
    levels.map((l) => l.id),
    levelId,
    dir
  );
  for (let i = 0; i < reordered.length; i++) {
    const l = levels.find((x) => x.id === reordered[i])!;
    if (l.sort_order === i) continue;
    const { error } = await supabase
      .from("sweetness_levels")
      .update({ sort_order: i })
      .eq("id", l.id)
      .eq("tenant_id", tenantId);
    if (error) {
      revalidateConfig();
      return { error: SAVE_FAIL };
    }
  }
  revalidateConfig();
  return { success: true };
}

// ── the shop's standard sweetness table ────────────────────────────────────

export async function saveStandardSweetness(
  cells: { memberId: string; levelId: string; amount: number }[]
): Promise<StockConfigState> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > 2000) return { error: BAD_INPUT };
  for (const c of cells) {
    if (!c || !isId(c.memberId) || !isId(c.levelId) || typeof c.amount !== "number") {
      return { error: BAD_INPUT };
    }
    const problem = validateSweetnessAmount(c.amount);
    if (problem) return { error: problem };
  }
  const supabase = await createClient();
  const tenantId = profile.tenant_id;

  // Every member must be a sweetener member of THIS shop; every level must be this shop's.
  const memberIds = Array.from(new Set(cells.map((c) => c.memberId)));
  const levelIds = Array.from(new Set(cells.map((c) => c.levelId)));
  const levels = await loadLevels(supabase, tenantId);
  const levelById = new Map(levels.map((l) => [l.id, l]));
  if (levelIds.some((id) => !levelById.has(id))) return { error: BAD_INPUT };

  const { data: groups } = await supabase
    .from("choice_groups")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("kind", "sweetener");
  const sweetenerGroupIds = (groups ?? []).map((g) => g.id);
  if (sweetenerGroupIds.length === 0) return { error: BAD_INPUT };
  const { data: members } = await supabase
    .from("choice_group_members")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("group_id", sweetenerGroupIds)
    .in("id", memberIds);
  if ((members?.length ?? 0) !== memberIds.length) return { error: BAD_INPUT };

  const seen = new Set<string>();
  const rows: { tenant_id: string; product_id: null; member_id: string; level_id: string; amount: number }[] = [];
  for (const c of cells) {
    const key = `${c.memberId}:${c.levelId}`;
    if (seen.has(key)) return { error: BAD_INPUT };
    seen.add(key);
    rows.push({
      tenant_id: tenantId,
      product_id: null,
      member_id: c.memberId,
      level_id: c.levelId,
      amount: levelById.get(c.levelId)!.is_none ? 0 : c.amount,
    });
  }

  const { error } = await supabase
    .from("sweetness_amounts")
    .upsert(rows, { onConflict: "tenant_id,product_id,member_id,level_id" });
  if (error) return { error: SAVE_FAIL };
  revalidateConfig();
  return { success: true };
}
