import { billLineDetail } from "./stock/option-window.ts";
import type { ChoiceSnapshot } from "./stock/stock-core.ts";
import { formatDateTime } from "./bangkok-time.ts";

export const RECEIPT_HEADING = "ใบเสร็จรับเงิน (ไม่ใช่ใบกำกับภาษี)";
export const RECEIPT_THANKS = "ขอบคุณที่อุดหนุน";
export const RECEIPT_NOT_FOUND = "ยังไม่พบใบเสร็จนี้ ถ้าเพิ่งซื้อตอนอินเทอร์เน็ตของร้านขัดข้อง ลองเปิดใหม่ภายหลัง";
export const RECEIPT_CANCELLED = "บิลนี้ถูกยกเลิกแล้ว";
export const RECEIPT_REFUNDED = "บิลนี้คืนเงินแล้ว";
export const RECEIPT_UNPAID = "ร้านยังไม่ได้รับเงินสำหรับบิลนี้ กรุณาติดต่อร้าน";

export type ReceiptItemData = {
  name: string;
  quantity: number;
  subtotal: number;
  choices: ChoiceSnapshot | null;
  options: (string | { option: string; priceDelta?: number; optionId?: string })[] | null;
};

export type ReceiptData = {
  shop_name: string;
  shop_logo_url: string | null;
  order_number: string | null;
  queue_number: number | null;
  created_at: string;
  status: string;
  items?: ReceiptItemData[];
  subtotal?: number;
  discount_amount?: number;
  total?: number;
  payment_method?: string;
  cash_received?: number | null;
  change_amount?: number | null;
};

export type ReceiptView =
  | { kind: "not_found"; message: string }
  | {
      kind: "notice"; shopName: string; logoUrl: string | null; billLine: string; dateTime: string;
      message: string; tone: "destructive" | "warning";
    }
  | {
      kind: "receipt"; shopName: string; logoUrl: string | null; billLine: string; dateTime: string;
      lines: { text: string; amount: string; detail: string | null }[];
      subtotal: string | null; discount: string | null; total: string; payment: string | null; cash: string | null;
    };

function money(n: number): string {
  return "฿" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const NOT_FOUND: ReceiptView = { kind: "not_found", message: RECEIPT_NOT_FOUND };

export function toReceiptView(data: ReceiptData | null): ReceiptView {
  if (!data) return NOT_FOUND;

  const head = {
    shopName: data.shop_name,
    logoUrl: data.shop_logo_url ? data.shop_logo_url : null,
    billLine: [
      data.order_number != null ? `บิล ${data.order_number}` : null,
      data.queue_number != null ? `คิว ${data.queue_number}` : null,
    ].filter((p): p is string => p !== null).join(" · "),
    dateTime: formatDateTime(data.created_at) + " น.",
  };

  const notice = (message: string, tone: "destructive" | "warning"): ReceiptView =>
    ({ kind: "notice", ...head, message, tone });

  if (data.status === "cancelled") return notice(RECEIPT_CANCELLED, "destructive");
  if (data.status === "refunded") return notice(RECEIPT_REFUNDED, "warning");
  if (data.status === "unpaid") return notice(RECEIPT_UNPAID, "destructive");
  if (data.status !== "completed") return NOT_FOUND;
  if (typeof data.total !== "number" || !Number.isFinite(data.total)) return NOT_FOUND;

  const lines = (data.items ?? []).map((it) => {
    // the house-glass word is for the kitchen, not the customer
    const choices = it.choices ? (({ packaging: _p, ...rest }) => (void _p, rest))(it.choices) : null;
    return {
      text: `${it.name} ×${it.quantity}`,
      amount: money(it.subtotal),
      detail: billLineDetail(choices, it.options ?? []),
    };
  });

  const hasDiscount = (data.discount_amount ?? 0) > 0;
  const cash = data.payment_method === "cash";
  const both = data.cash_received != null && data.change_amount != null;

  return {
    kind: "receipt",
    ...head,
    lines,
    subtotal: hasDiscount && typeof data.subtotal === "number" ? money(data.subtotal) : null,
    discount: hasDiscount ? "-" + money(data.discount_amount as number) : null,
    total: money(data.total),
    payment: cash ? "ชำระโดย เงินสด" : data.payment_method === "transfer" ? "ชำระโดย โอนเงิน" : null,
    cash: cash && both ? `รับเงิน ${money(data.cash_received as number)} · ทอน ${money(data.change_amount as number)}` : null,
  };
}

export function receiptTitle(view: ReceiptView): string {
  return view.kind === "not_found" ? "ใบเสร็จ" : `ใบเสร็จ · ${view.shopName}`;
}
