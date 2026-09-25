"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import { computeDiscount, type DiscountType } from "@/lib/discount";
import { priceCartItems, type PricedLine } from "@/lib/order-pricing";
import { diffReductions } from "@/lib/held-bill-diff";
import type { CartItem } from "@/types/app";
import type { Json } from "@/types/database";

const MAX_LABEL = 40;
const CONFLICT = "บิลนี้ถูกแก้ไขหรือปิดไปแล้ว กรุณาเปิดรายการบิลพักใหม่";

export type HeldBillInput = {
  items: CartItem[];
  orderType: "dine_in" | "take_away";
  customerId: string | null;
  customerLabel: string;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountReason: string;
};

type Validated = {
  items: CartItem[];
  orderType: "dine_in" | "take_away";
  customerId: string | null;
  customerLabel: string | null;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountReason: string | null;
  total: number;
};

/**
 * Stored items are rebuilt from the server's pricing so the snapshot (and therefore the audit log
 * that diffs it) carries real product/option names and prices, not whatever the client sent.
 */
function normalizedItems(input: CartItem[], lines: PricedLine[]): CartItem[] {
  return input.map((item, i) => {
    const line = lines[i]!;
    return {
      cartItemKey: item.cartItemKey,
      productId: line.productId,
      name: line.productName,
      basePrice: line.unitPrice - (line.modifiersSnapshot ?? []).reduce((s, m) => s + m.priceDelta, 0),
      quantity: line.quantity,
      selectedModifiers: item.selectedModifiers.map((m, j) => ({
        modifierId: m.modifierId,
        optionId: m.optionId,
        modifierName: line.modifiersSnapshot?.[j]?.group ?? m.modifierName,
        optionName: line.modifiersSnapshot?.[j]?.option ?? m.optionName,
        priceDelta: line.modifiersSnapshot?.[j]?.priceDelta ?? 0,
      })),
      totalPrice: line.lineTotal,
      note: line.note,
    };
  });
}

async function validate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  input: HeldBillInput
): Promise<Validated | { error: string }> {
  if (input.orderType !== "dine_in" && input.orderType !== "take_away") {
    return { error: "ข้อมูลบิลไม่ถูกต้อง" };
  }
  const priced = await priceCartItems(supabase, tenantId, input.items);
  if ("error" in priced) return { error: priced.error };

  const label = typeof input.customerLabel === "string" ? input.customerLabel.trim() : "";
  if (label.length > MAX_LABEL) return { error: `ชื่อลูกค้ายาวเกิน ${MAX_LABEL} ตัวอักษร` };

  let discountType: DiscountType | null = null;
  let discountValue: number | null = null;
  let discountAmount = 0;
  if (input.discountType !== null && input.discountType !== undefined) {
    const value = input.discountValue;
    if (
      (input.discountType !== "percent" && input.discountType !== "amount") ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0 ||
      (input.discountType === "percent" && value > 100) ||
      (input.discountType === "amount" && value > priced.subtotal)
    ) {
      return { error: "ส่วนลดไม่ถูกต้อง" };
    }
    discountType = input.discountType;
    discountValue = value;
    discountAmount = computeDiscount(priced.subtotal, discountType, value).discountAmount;
  }
  const reason = typeof input.discountReason === "string" ? input.discountReason.trim() : "";

  // Written with the admin client, so tenant ownership of the member must be checked here (RLS on
  // the user client scopes this lookup to the caller's shop).
  if (input.customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", input.customerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!customer) return { error: "ไม่พบข้อมูลสมาชิก" };
  }

  return {
    items: normalizedItems(input.items, priced.lines),
    orderType: input.orderType,
    customerId: input.customerId ?? null,
    customerLabel: label === "" ? null : label,
    discountType,
    discountValue,
    discountReason: discountType !== null && reason !== "" ? reason : null,
    total: priced.subtotal - discountAmount,
  };
}

export async function holdBill(
  input: HeldBillInput
): Promise<{ id: string; queueNumber: number; version: number } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  const supabase = await createClient();

  const v = await validate(supabase, profile.tenant_id, input);
  if ("error" in v) return v;

  const { data: queueNumber, error: queueError } = await supabase.rpc("next_queue_number", {
    p_tenant_id: profile.tenant_id,
  });
  if (queueError || typeof queueNumber !== "number") return { error: "สร้างเลขคิวไม่สำเร็จ" };

  const admin = createAdminClient();
  const { data: bill, error } = await admin
    .from("held_bills")
    .insert({
      tenant_id: profile.tenant_id,
      queue_number: queueNumber,
      business_date: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10),
      customer_label: v.customerLabel,
      customer_id: v.customerId,
      order_type: v.orderType,
      items: v.items as unknown as Json,
      discount_type: v.discountType,
      discount_value: v.discountValue,
      discount_reason: v.discountReason,
      created_by: profile.id,
      updated_by: profile.id,
    })
    .select("id, version")
    .single();
  if (error || !bill) return { error: "พักบิลไม่สำเร็จ" };

  await admin.from("held_bill_events").insert({
    held_bill_id: bill.id,
    tenant_id: profile.tenant_id,
    actor_id: profile.id,
    event_type: "held",
    detail: { total: v.total, items: v.items.length },
  });

  revalidatePath("/pos");
  return { id: bill.id, queueNumber, version: bill.version };
}

export async function updateHeldBill(
  id: string,
  version: number,
  input: HeldBillInput
): Promise<{ version: number } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: stored } = await admin
    .from("held_bills")
    .select("id, items, status, version")
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();
  if (!stored || stored.status !== "open" || stored.version !== version) return { error: CONFLICT };

  const v = await validate(supabase, profile.tenant_id, input);
  if ("error" in v) return v;

  // Conditional on the version the cashier loaded, so two edits can't silently overwrite each other.
  const { data: updated, error } = await admin
    .from("held_bills")
    .update({
      items: v.items as unknown as Json,
      order_type: v.orderType,
      customer_id: v.customerId,
      customer_label: v.customerLabel,
      discount_type: v.discountType,
      discount_value: v.discountValue,
      discount_reason: v.discountReason,
      version: version + 1,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "open")
    .eq("version", version)
    .select("version");
  if (error) return { error: "บันทึกบิลพักไม่สำเร็จ" };
  if (!updated || updated.length === 0) return { error: CONFLICT };

  const reductions = diffReductions(stored.items as unknown as CartItem[], v.items);
  const events: {
    held_bill_id: string;
    tenant_id: string;
    actor_id: string;
    event_type: string;
    detail: Json;
  }[] = [];
  if (reductions.length > 0) {
    events.push({
      held_bill_id: id,
      tenant_id: profile.tenant_id,
      actor_id: profile.id,
      event_type: "items_reduced",
      detail: { reductions } as unknown as Json,
    });
  }
  events.push({
    held_bill_id: id,
    tenant_id: profile.tenant_id,
    actor_id: profile.id,
    event_type: "updated",
    detail: { total: v.total, items: v.items.length },
  });
  await admin.from("held_bill_events").insert(events);

  revalidatePath("/pos");
  return { version: updated[0]!.version };
}

export async function cancelHeldBill(
  id: string,
  reason: string,
  pin: string
): Promise<{ success: true } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (typeof reason !== "string" || reason.trim() === "") return { error: "กรุณาระบุเหตุผล" };
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) return { error: "PIN ไม่ถูกต้อง" };

  const admin = createAdminClient();
  const { data: approvers } = await admin
    .from("profiles")
    .select("id, pin_hash")
    .eq("tenant_id", profile.tenant_id)
    .in("role", ["owner", "manager"])
    .not("pin_hash", "is", null);

  let approverId: string | null = null;
  for (const approver of approvers ?? []) {
    if (approver.pin_hash && (await bcrypt.compare(pin, approver.pin_hash))) {
      approverId = approver.id;
      break;
    }
  }
  if (!approverId) return { error: "PIN ไม่ถูกต้อง" };

  const { data: updated, error } = await admin
    .from("held_bills")
    .update({
      status: "cancelled",
      cancelled_by: profile.id,
      cancelled_approved_by: approverId,
      cancel_reason: reason.trim(),
      cancelled_at: new Date().toISOString(),
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "open")
    .select("id");
  if (error) return { error: "ยกเลิกบิลพักไม่สำเร็จ" };
  if (!updated || updated.length === 0) return { error: CONFLICT };

  await admin.from("held_bill_events").insert({
    held_bill_id: id,
    tenant_id: profile.tenant_id,
    actor_id: profile.id,
    event_type: "cancelled",
    detail: { reason: reason.trim(), approved_by: approverId },
  });

  revalidatePath("/pos");
  return { success: true };
}
