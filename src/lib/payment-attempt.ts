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

/** How long the POS waits for a payment answer before treating it as "no answer". */
export const PAYMENT_DEADLINE_MS = 15_000;

export class DeadlineError extends Error {
  constructor() {
    super("deadline");
    this.name = "DeadlineError";
  }
}

/**
 * Rejects with DeadlineError if `p` hasn't settled within `ms`. Safe for payments because every
 * try of an attempt carries the same client_ref: giving up never risks a second bill.
 */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * What the cart shows. An attempt nobody could confirm (unresolvedRef) keeps its warning above
 * any other message until a sale succeeds or the cart is cleared: it is the one thing standing
 * between the cashier and charging that customer twice.
 */
export function cartWarning(error: string | null, unresolvedRef: string | null): string | null {
  if (unresolvedRef === null || error === UNRESOLVED_PAYMENT_MESSAGE) return error;
  return error === null ? UNRESOLVED_PAYMENT_MESSAGE : `${UNRESOLVED_PAYMENT_MESSAGE}\n${error}`;
}

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
