export const DISCOUNT_APPROVAL_THRESHOLD_PERCENT = 20;
export const DISCOUNT_APPROVAL_THRESHOLD_AMOUNT = 100;

export type DiscountType = "percent" | "amount";

export function computeDiscount(
  subtotal: number,
  type: DiscountType | null,
  value: number
): { discountAmount: number; requiresApproval: boolean; total: number } {
  if (type === null || !Number.isFinite(value) || value <= 0) {
    return { discountAmount: 0, requiresApproval: false, total: subtotal };
  }
  const rawAmount =
    type === "percent" ? subtotal * (value / 100) : Math.min(value, subtotal);
  const discountAmount = Math.round(rawAmount * 100) / 100;
  const requiresApproval =
    discountAmount > DISCOUNT_APPROVAL_THRESHOLD_AMOUNT ||
    (subtotal > 0 &&
      discountAmount / subtotal > DISCOUNT_APPROVAL_THRESHOLD_PERCENT / 100);
  return { discountAmount, requiresApproval, total: subtotal - discountAmount };
}
