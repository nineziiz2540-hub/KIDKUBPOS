// A payment attempt is "this cart, paid this way". The POS keeps one client_ref per attempt and
// sends it with every try (see createOrder), so a retry after a lost response returns the bill
// that was already saved instead of recording the sale twice. The ref is reused only while the
// fingerprint below is unchanged: anything that would make it a different sale starts a new one.
import type { CartItem } from "../types/app.ts";

/** Shown in the payment window when a try got no answer; retrying the same attempt is safe. */
export const CONNECTION_RETRY_MESSAGE =
  "การเชื่อมต่อสะดุด · กดลองอีกครั้งได้เลย ระบบจะไม่บันทึกบิลซ้ำ";

/** Last resort: the POS could not even ask whether the attempt was saved. */
export const UNRESOLVED_PAYMENT_MESSAGE =
  "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบหน้ารายการบิลก่อนกดชำระซ้ำ";

export type AttemptInput = {
  items: CartItem[];
  paymentMethod: string;
  orderType: string;
  customerId: string | null;
  discountType: string | null;
  discountValue: string;
  heldBillId: string | null;
  heldBillVersion: number | null;
};

/** A stable string of exactly the fields that make up one sale. */
export function attemptFingerprint(input: AttemptInput): string {
  return JSON.stringify([
    input.items.map((i) => [
      i.productId,
      i.quantity,
      i.totalPrice,
      i.note,
      i.selectedModifiers.map((m) => m.optionId),
    ]),
    input.paymentMethod,
    input.orderType,
    input.customerId,
    input.discountType,
    input.discountValue,
    input.heldBillId,
    input.heldBillVersion,
  ]);
}
