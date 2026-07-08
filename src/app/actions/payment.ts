"use server";
import { getProfile, getTenantPromptPayId } from "@/lib/dal";
import generatePayload from "promptpay-qr";

export async function generatePaymentQr(
  total: number
): Promise<{ qrPayload: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const promptpayId = await getTenantPromptPayId(profile.tenant_id);
  if (!promptpayId) {
    return { error: "ร้านยังไม่ได้ตั้งค่า PromptPay ID กรุณาไปที่หน้าตั้งค่า" };
  }

  const qrPayload = generatePayload(promptpayId, { amount: total });
  return { qrPayload };
}
