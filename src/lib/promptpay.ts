// PromptPay QR payload, built on the device. The QR modal used to ask the server for the shop's
// PromptPay ID on every open, and a failed request left it on "กำลังสร้าง QR…" forever. The ID
// now comes with the POS page (and the heartbeat keeps it current), so no request is needed here.
import generatePayload from "promptpay-qr";
import { toSatang } from "./cash.ts";

/** EMVCo payload for `amount` baht to `promptpayId`; the amount is rounded to satang first. */
export function buildPromptPayPayload(promptpayId: string, amount: number): string {
  return generatePayload(promptpayId, { amount: toSatang(amount) / 100 });
}
