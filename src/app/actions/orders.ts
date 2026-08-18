"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, getActiveShift } from "@/lib/dal";
import { computeDiscount } from "@/lib/discount";
import type { CreateOrderInput } from "@/types/app";

export async function createOrder(
  data: CreateOrderInput
): Promise<{ error: string } | { orderId: string; orderNumber: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (data.items.length === 0) return { error: "ไม่มีสินค้าในตะกร้า" };

  const supabase = await createClient();

  // 1. Fetch category names for snapshot (one query for all products in cart)
  const productIds = [...new Set(data.items.map((i) => i.productId))];
  const { data: productRows } = await supabase
    .from("products")
    .select("id, categories(name)")
    .in("id", productIds)
    .eq("tenant_id", profile.tenant_id);

  const categoryMap = new Map<string, string>();
  for (const p of productRows ?? []) {
    const cat = p.categories as { name: string } | null;
    if (cat) categoryMap.set(p.id, cat.name);
  }

  // 2. Calculate subtotal from CartItem.totalPrice
  const subtotal = data.items.reduce((sum, item) => sum + item.totalPrice, 0);

  // 3. Resolve and validate the discount, if any
  let discountType: "percent" | "amount" | null = null;
  let discountValue: number | null = null;
  let discountReason: string | null = null;
  let discountAmount = 0;
  let requiresApproval = false;

  if (data.discountType !== undefined) {
    if (data.discountType !== "percent" && data.discountType !== "amount") {
      return { error: "ส่วนลดไม่ถูกต้อง" };
    }
    const value = data.discountValue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return { error: "ส่วนลดไม่ถูกต้อง" };
    }
    if (data.discountType === "percent" && value > 100) {
      return { error: "ส่วนลดไม่ถูกต้อง" };
    }
    if (data.discountType === "amount" && value > subtotal) {
      return { error: "ส่วนลดมากกว่ายอดรวม" };
    }

    const computed = computeDiscount(subtotal, data.discountType, value);
    discountType = data.discountType;
    discountValue = value;
    discountAmount = computed.discountAmount;
    requiresApproval = computed.requiresApproval;

    const reason = (data.discountReason ?? "").trim();
    if (requiresApproval && reason === "") {
      return { error: "กรุณาระบุเหตุผลสำหรับส่วนลดนี้" };
    }
    discountReason = reason !== "" ? reason : null;
  }

  const total = subtotal - discountAmount;

  // 4. PIN-verify a Manager/Owner approver when the discount crosses the threshold
  let approverId: string | null = null;
  if (requiresApproval) {
    const pin = data.approverPin;
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
      return { error: "PIN ไม่ถูกต้อง" };
    }

    const admin = createAdminClient();
    const { data: approvers } = await admin
      .from("profiles")
      .select("id, pin_hash")
      .eq("tenant_id", profile.tenant_id)
      .in("role", ["owner", "manager"])
      .not("pin_hash", "is", null);

    for (const approver of approvers ?? []) {
      if (approver.pin_hash && (await bcrypt.compare(pin, approver.pin_hash))) {
        approverId = approver.id;
        break;
      }
    }
    if (!approverId) return { error: "PIN ไม่ถูกต้อง" };
  }

  // 5. Best-effort: attach the currently open shift (does not block the sale if none is open)
  const activeShift = await getActiveShift(profile.tenant_id);

  // 6. Generate order number atomically — deferred until after all validation above so a
  // rejected attempt (bad discount value, wrong PIN, etc.) never burns a sequence number.
  const { data: orderNumber, error: seqError } = await supabase.rpc(
    "generate_order_number",
    { p_tenant_id: profile.tenant_id }
  );
  if (seqError || !orderNumber) return { error: "สร้างเลขออเดอร์ไม่สำเร็จ" };

  // 7. Insert order row. Written via the admin client only when an approval was just verified
  // above (discount_approved_by non-null) — prevent_direct_discount_approval rejects that exact
  // write from any caller except service_role, so the trigger and this client choice must be
  // changed together.
  const insertClient = approverId !== null ? createAdminClient() : supabase;
  const { data: order, error: orderError } = await insertClient
    .from("orders")
    .insert({
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      payment_method: data.paymentMethod,
      subtotal,
      total,
      discount_type: discountType,
      discount_value: discountValue,
      discount_amount: discountAmount,
      discount_reason: discountReason,
      discount_approved_by: approverId,
      order_number: orderNumber,
      order_type: data.orderType,
      table_number: data.tableNumber ?? null,
      customer_id: data.customerId ?? null,
      note: data.note ?? null,
      shift_id: activeShift?.id ?? null,
    })
    .select("id")
    .single();

  if (orderError || !order) return { error: "บันทึกออเดอร์ไม่สำเร็จ" };

  // 8. Build order_items with snapshots
  const orderItems = data.items.map((item) => ({
    order_id: order.id,
    product_id: item.productId,
    product_name: item.name,
    unit_price: item.totalPrice / item.quantity,
    quantity: item.quantity,
    subtotal: item.totalPrice,
    category_name: categoryMap.get(item.productId) ?? null,
    modifiers_snapshot:
      item.selectedModifiers.length > 0
        ? item.selectedModifiers.map((m) => ({
            group: m.modifierName,
            option: m.optionName,
            priceDelta: m.priceDelta,
          }))
        : null,
  }));

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems);
  if (itemsError) return { error: "บันทึกรายการสินค้าไม่สำเร็จ" };

  // 9. Deduct stock (best-effort — don't block on failure)
  const { error: deductError } = await supabase.rpc("deduct_stock_for_order", {
    p_order_id: order.id,
  });
  if (deductError) {
    console.error(
      "[createOrder] deduct_stock_for_order failed:",
      deductError.message
    );
  }

  revalidatePath("/orders");
  return { orderId: order.id, orderNumber };
}

export type VoidOrderState = { error?: string; success?: boolean } | undefined;

export async function voidOrder(
  prevState: VoidOrderState,
  formData: FormData
): Promise<VoidOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const orderId = formData.get("order_id");
  const reason = formData.get("reason");
  const pin = formData.get("pin");

  if (
    typeof orderId !== "string" ||
    typeof reason !== "string" ||
    typeof pin !== "string"
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (reason.trim() === "") {
    return { error: "กรุณาระบุเหตุผล" };
  }
  if (!/^\d{6}$/.test(pin)) {
    return { error: "PIN ไม่ถูกต้อง" };
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, shift_id")
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!order) return { error: "ไม่พบบิลนี้" };
  if (order.status === "cancelled") return { error: "บิลนี้ถูกยกเลิกไปแล้ว" };
  if (order.status === "refunded") return { error: "บิลนี้ถูกคืนเงินไปแล้ว ไม่สามารถยกเลิกได้" };

  const activeShift = await getActiveShift(profile.tenant_id);
  if (!activeShift || order.shift_id !== activeShift.id) {
    return { error: "ยกเลิกได้เฉพาะบิลในกะที่เปิดอยู่ตอนนี้" };
  }

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

  // Written via the admin client, not the regular one: orders_update_own_tenant RLS has no
  // WITH CHECK, so any tenant member could otherwise PATCH status/cancelled_* directly through
  // the Data API and skip this PIN check entirely. A BEFORE UPDATE trigger
  // (prevent_direct_order_void) rejects this exact write from any caller whose auth.uid() is
  // non-null — i.e. everyone except this service_role call — so the trigger and this client
  // choice must be changed together.
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: profile.id,
      cancelled_approved_by: approverId,
      cancel_reason: reason.trim(),
    })
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "completed")
    .select("id");

  if (updateError || !updated || updated.length === 0) {
    if (!updateError) {
      // 0 rows with no error means the status/tenant/id filter didn't match — most likely
      // someone else's concurrent void already won the race, not a real failure.
      const { data: recheck } = await admin
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();
      if (recheck?.status === "cancelled") {
        return { error: "บิลนี้ถูกยกเลิกไปแล้ว" };
      }
    }
    console.error(
      "voidOrder: failed to update order:",
      updateError ?? "update matched 0 rows (row missing or tenant mismatch)"
    );
    return { error: "ยกเลิกบิลไม่สำเร็จ" };
  }

  // Also via the admin client: restock_for_voided_order's EXECUTE grant was revoked from
  // authenticated/anon so it can't be called directly (and looped) through the Data API to
  // inflate stock without ever actually voiding an order.
  const { error: restockError } = await admin.rpc("restock_for_voided_order", {
    p_order_id: orderId,
  });
  if (restockError) {
    console.error(
      "[voidOrder] restock_for_voided_order failed:",
      restockError.message
    );
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { success: true };
}

export type RefundOrderState = { error?: string; success?: boolean } | undefined;

export async function refundOrder(
  prevState: RefundOrderState,
  formData: FormData
): Promise<RefundOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const orderId = formData.get("order_id");
  const refundMethod = formData.get("refund_method");
  const reason = formData.get("reason");
  const pin = formData.get("pin");

  if (
    typeof orderId !== "string" ||
    typeof refundMethod !== "string" ||
    typeof reason !== "string" ||
    typeof pin !== "string"
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (
    refundMethod !== "cash" &&
    refundMethod !== "transfer" &&
    refundMethod !== "card"
  ) {
    return { error: "กรุณาเลือกวิธีคืนเงิน" };
  }
  if (reason.trim() === "") {
    return { error: "กรุณาระบุเหตุผล" };
  }
  if (!/^\d{6}$/.test(pin)) {
    return { error: "PIN ไม่ถูกต้อง" };
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!order) return { error: "ไม่พบบิลนี้" };
  if (order.status === "cancelled") {
    return { error: "บิลนี้ถูกยกเลิกไปแล้ว ไม่สามารถคืนเงินได้" };
  }
  if (order.status === "refunded") return { error: "บิลนี้ถูกคืนเงินไปแล้ว" };

  const activeShift = await getActiveShift(profile.tenant_id);
  if (refundMethod === "cash" && !activeShift) {
    return { error: "ต้องเปิดกะก่อนจึงจะคืนเงินสดได้" };
  }

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

  // Written via the admin client from the start (unlike voidOrder's original commit, which
  // needed a later fix): orders_update_own_tenant RLS has no WITH CHECK, so any tenant member
  // could otherwise PATCH the refund_* columns directly through the Data API. The
  // prevent_direct_order_refund trigger rejects this exact write from any caller whose
  // auth.uid() is non-null — i.e. everyone except this service_role call — so the trigger and
  // this client choice must be changed together.
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      refunded_by: profile.id,
      refunded_approved_by: approverId,
      refund_reason: reason.trim(),
      refund_method: refundMethod,
      refund_shift_id: activeShift?.id ?? null,
    })
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "completed")
    .select("id");

  if (updateError || !updated || updated.length === 0) {
    if (!updateError) {
      // 0 rows with no error means the status/tenant/id filter didn't match — most likely
      // someone else's concurrent void/refund already won the race, not a real failure.
      const { data: recheck } = await admin
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();
      if (recheck?.status === "cancelled") {
        return { error: "บิลนี้ถูกยกเลิกไปแล้ว ไม่สามารถคืนเงินได้" };
      }
      if (recheck?.status === "refunded") {
        return { error: "บิลนี้ถูกคืนเงินไปแล้ว" };
      }
    }
    console.error(
      "refundOrder: failed to update order:",
      updateError ?? "update matched 0 rows (row missing or tenant mismatch)"
    );
    return { error: "คืนเงินไม่สำเร็จ" };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { success: true };
}
