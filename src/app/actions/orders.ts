"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
