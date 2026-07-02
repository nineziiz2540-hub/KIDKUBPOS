"use server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export async function findOrCreateCustomer(data: {
  phone?: string;
  name: string;
}): Promise<{ customerId: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  if (!data.name.trim()) return { error: "กรุณากรอกชื่อลูกค้า" };

  const supabase = await createClient();

  // If phone provided, try to find existing customer
  if (data.phone && data.phone.trim() !== "") {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", profile.tenant_id)
      .eq("phone", data.phone.trim())
      .single();

    if (existing) return { customerId: existing.id };
  }

  // Create new customer
  const { data: customer, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: profile.tenant_id,
      name: data.name.trim(),
      phone: data.phone?.trim() ?? null,
    })
    .select("id")
    .single();

  if (error || !customer) return { error: "บันทึกข้อมูลลูกค้าไม่สำเร็จ" };

  return { customerId: customer.id };
}
