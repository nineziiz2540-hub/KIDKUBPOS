"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, getActiveShift } from "@/lib/dal";
import type { CreateOrderInput } from "@/types/app";

export async function createOrder(
  data: CreateOrderInput
): Promise<{ error: string } | { orderId: string; orderNumber: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (data.items.length === 0) return { error: "ไม่มีสินค้าในตะกร้า" };

  const supabase = await createClient();

  // 1. Generate order number atomically
  const { data: orderNumber, error: seqError } = await supabase.rpc(
    "generate_order_number",
    { p_tenant_id: profile.tenant_id }
  );
  if (seqError || !orderNumber) return { error: "สร้างเลขออเดอร์ไม่สำเร็จ" };

  // 2. Fetch category names for snapshot (one query for all products in cart)
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

  // 3. Calculate total from CartItem.totalPrice
  const total = data.items.reduce((sum, item) => sum + item.totalPrice, 0);

  // 3.5. Best-effort: attach the currently open shift (does not block the sale if none is open)
  const activeShift = await getActiveShift(profile.tenant_id);

  // 4. Insert order row
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      payment_method: data.paymentMethod,
      total,
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

  // 5. Build order_items with snapshots
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

  // 6. Deduct stock (best-effort — don't block on failure)
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

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: profile.id,
      cancelled_approved_by: approverId,
      cancel_reason: reason.trim(),
    })
    .eq("id", orderId)
    .eq("status", "completed")
    .select("id");

  if (updateError || !updated || updated.length === 0) {
    console.error(
      "voidOrder: failed to update order:",
      updateError ?? "update matched 0 rows (RLS rejected or row missing)"
    );
    return { error: "ยกเลิกบิลไม่สำเร็จ" };
  }

  const { error: restockError } = await supabase.rpc("restock_for_voided_order", {
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
