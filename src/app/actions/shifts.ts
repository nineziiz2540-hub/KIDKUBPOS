"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getActiveShift, getShiftSummary } from "@/lib/dal";

export async function openShift(
  openingCash: number
): Promise<{ shiftId: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (isNaN(openingCash) || openingCash < 0) {
    return { error: "กรุณากรอกเงินสดตั้งต้นที่ถูกต้อง (>= 0)" };
  }

  const existing = await getActiveShift(profile.tenant_id);
  if (existing) return { error: "มีกะที่เปิดอยู่แล้ว" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shifts")
    .insert({
      tenant_id: profile.tenant_id,
      opened_by: profile.id,
      opening_cash: openingCash,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "เปิดกะไม่สำเร็จ" };

  revalidatePath("/shifts");
  revalidatePath("/pos");
  return { shiftId: data.id };
}

export async function closeShift(
  shiftId: string,
  closingCashCounted: number
): Promise<{ variance: number } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (isNaN(closingCashCounted) || closingCashCounted < 0) {
    return { error: "กรุณากรอกเงินสดที่นับได้ที่ถูกต้อง (>= 0)" };
  }

  const summary = await getShiftSummary(profile.tenant_id, shiftId);
  const variance = closingCashCounted - summary.expectedCash;

  const supabase = await createClient();
  const { error } = await supabase
    .from("shifts")
    .update({
      closed_by: profile.id,
      closed_at: new Date().toISOString(),
      closing_cash_counted: closingCashCounted,
      expected_cash: summary.expectedCash,
      variance,
      status: "closed",
    })
    .eq("id", shiftId)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "ปิดกะไม่สำเร็จ" };

  revalidatePath("/shifts");
  revalidatePath("/pos");
  return { variance };
}
