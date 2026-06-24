"use server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
};

type PaymentMethod = "cash" | "transfer" | "card";

export async function createOrder(data: {
  items: CartItem[];
  paymentMethod: PaymentMethod;
}): Promise<{ error: string } | undefined> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (data.items.length === 0) return { error: "ไม่มีสินค้าในตะกร้า" };

  const total = data.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      payment_method: data.paymentMethod,
      total,
    })
    .select("id")
    .single();

  if (orderError || !order) return { error: "บันทึกออเดอร์ไม่สำเร็จ" };

  const orderItems = data.items.map((item) => ({
    order_id: order.id,
    product_id: item.productId,
    product_name: item.name,
    unit_price: item.price,
    quantity: item.quantity,
    subtotal: item.price * item.quantity,
  }));

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems);

  if (itemsError) return { error: "บันทึกรายการสินค้าไม่สำเร็จ" };

  return undefined;
}
