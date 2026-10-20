import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  getActiveShift,
  getHeldBillHistory,
  getOrderAdjustments,
  getPeopleNames,
  getProfile,
  type HeldBillEvent,
  type OrderAdjustment,
} from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { VoidOrderButton } from "@/components/orders/void-order-button";
import { RefundOrderButton } from "@/components/orders/refund-order-button";
import { ChangeMethodButton } from "@/components/orders/change-method-button";
import { MarkUnpaidButton } from "@/components/orders/mark-unpaid-button";
import { RestorePaidButton } from "@/components/orders/restore-paid-button";
import { TransferCheckToggle } from "@/components/orders/transfer-check-toggle";
import { formatDateTime, formatTime } from "@/lib/bangkok-time";

type OrderItem = {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  modifiers_snapshot: { option: string }[] | null;
  note: string | null;
};

type OrderDetail = {
  id: string;
  order_number: string | null;
  queue_number: number | null;
  held_bill_id: string | null;
  payment_method: string;
  status: string;
  subtotal: number;
  discount_type: string | null;
  discount_value: number | null;
  discount_amount: number;
  discount_reason: string | null;
  discount_approved_by: string | null;
  total: number;
  cash_received: number | null;
  change_amount: number | null;
  note: string | null;
  created_at: string;
  created_by: string;
  customer_id: string | null;
  shift_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_approved_by: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  refund_method: string | null;
  refunded_by: string | null;
  refunded_approved_by: string | null;
  unpaid_at: string | null;
  unpaid_reason: string | null;
  unpaid_by: string | null;
  unpaid_approved_by: string | null;
  transfer_verified_at: string | null;
  transfer_verified_by: string | null;
  order_items: OrderItem[];
};

const ORDER_SELECT = [
  "id, order_number, queue_number, held_bill_id, payment_method, status, subtotal",
  "discount_type, discount_value, discount_amount, discount_reason, discount_approved_by",
  "total, cash_received, change_amount, note, created_at, created_by, customer_id, shift_id",
  "cancelled_at, cancel_reason, cancelled_by, cancelled_approved_by",
  "refunded_at, refund_reason, refund_method, refunded_by, refunded_approved_by",
  "unpaid_at, unpaid_reason, unpaid_by, unpaid_approved_by",
  "transfer_verified_at, transfer_verified_by",
  "order_items(id, product_name, unit_price, quantity, subtotal, modifiers_snapshot, note)",
].join(", ");

const HELD_EVENT_LABELS: Record<HeldBillEvent["eventType"], string> = {
  held: "พักบิล",
  updated: "แก้ไขบิลพัก",
  items_reduced: "ลดรายการ",
  paid: "ชำระเงิน",
  cancelled: "ยกเลิก",
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
};

const STATUS: Record<string, { label: string; className: string }> = {
  completed: { label: "สำเร็จ", className: "text-success" },
  cancelled: { label: "ยกเลิก", className: "text-destructive" },
  refunded: { label: "คืนเงิน", className: "text-warning" },
  unpaid: { label: "ไม่ได้รับเงิน", className: "text-destructive" },
};

function adjustmentLabel(a: OrderAdjustment): string {
  switch (a.kind) {
    case "payment_method_change":
      return `แก้ช่องทางชำระ ${PAYMENT_LABELS[a.fromValue] ?? a.fromValue} → ${
        PAYMENT_LABELS[a.toValue] ?? a.toValue
      }`;
    case "mark_unpaid":
      return "แจ้งไม่ได้รับเงิน";
    case "restore_paid":
      return "ได้รับเงินแล้ว";
    default:
      return a.kind;
  }
}

/** Only same-app history URLs are allowed back, so ?back= can't send anyone elsewhere. */
function safeBackHref(back: string | undefined): string {
  if (back && back.startsWith("/orders") && !back.startsWith("//")) return back;
  return "/orders";
}

function Row({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex justify-between gap-4 text-base">
      <span className="text-muted-foreground">{label}</span>
      <span className={`max-w-[60%] text-right font-medium text-sidebar ${className}`}>{children}</span>
    </div>
  );
}

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
};

export default async function OrderDetailPage({ params, searchParams }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const { id } = await params;
  const backHref = safeBackHref((await searchParams).back);
  const supabase = await createClient();

  const { data: order } = (await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .single()) as { data: OrderDetail | null };

  if (!order) notFound();

  const personIds = [
    order.created_by,
    order.discount_approved_by,
    order.cancelled_by,
    order.cancelled_approved_by,
    order.refunded_by,
    order.refunded_approved_by,
    order.unpaid_by,
    order.unpaid_approved_by,
  ];

  const [heldHistory, adjustments, activeShift, customer] = await Promise.all([
    order.held_bill_id ? getHeldBillHistory(profile.tenant_id, order.held_bill_id) : [],
    getOrderAdjustments(profile.tenant_id, order.id),
    getActiveShift(profile.tenant_id),
    order.customer_id
      ? supabase
          .from("customers")
          .select("id, name")
          .eq("id", order.customer_id)
          .eq("tenant_id", profile.tenant_id)
          .maybeSingle()
          .then((r) => r.data)
      : null,
  ]);

  const names = await getPeopleNames(profile.tenant_id, [
    ...personIds,
    ...adjustments.flatMap((a) => [a.actorId, a.approverId]),
  ].filter((v): v is string => v !== null));
  const nameOf = (pid: string | null) => (pid ? (names[pid] ?? "—") : "—");
  const withApprover = (by: string | null, approver: string | null) =>
    approver ? `${nameOf(by)} · อนุมัติโดย ${nameOf(approver)}` : nameOf(by);

  const status = STATUS[order.status] ?? { label: order.status, className: "" };
  const isTransfer = order.payment_method === "transfer";
  const isManager = profile.role === "owner" || profile.role === "manager";
  const shiftOpen = order.shift_id === null || activeShift?.id === order.shift_id;

  return (
    <div className="max-w-xl space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link
          href={backHref}
          aria-label="กลับไปประวัติบิล"
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-sidebar"
        >
          <ChevronLeft size={24} />
        </Link>
        <div>
          <h1 className="font-mono text-2xl font-bold text-sidebar">
            {order.order_number ?? `#${order.id.slice(0, 8).toUpperCase()}`}
            {order.queue_number !== null && (
              <span className="ml-3 rounded-full bg-accent/10 px-3 py-1 align-middle font-sans text-base font-semibold text-accent">
                คิว {order.queue_number}
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-base text-muted-foreground">
            {formatDateTime(order.created_at, "long")}
          </p>
        </div>
      </div>

      {/* Line items */}
      <div className="divide-y divide-border rounded-xl border bg-white">
        {order.order_items.map((item) => (
          <div key={item.id} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-sidebar">{item.product_name}</p>
              {item.modifiers_snapshot && item.modifiers_snapshot.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {item.modifiers_snapshot.map((m) => m.option).join(", ")}
                </p>
              )}
              {item.note && <p className="text-sm font-medium text-accent">📝 {item.note}</p>}
              <p className="text-sm text-muted-foreground">
                ฿{Number(item.unit_price).toFixed(2)} × {item.quantity}
              </p>
            </div>
            <p className="text-base font-semibold tabular-nums text-sidebar">
              ฿{Number(item.subtotal).toFixed(2)}
            </p>
          </div>
        ))}
        {order.order_items.length === 0 && (
          <p className="px-4 py-8 text-center text-base text-muted-foreground">ไม่มีรายการสินค้า</p>
        )}
      </div>

      {/* Order summary */}
      <div className="space-y-2 rounded-xl border bg-white px-4 py-4">
        <Row label="วิธีชำระ">{PAYMENT_LABELS[order.payment_method] ?? order.payment_method}</Row>
        <Row label="สถานะ" className={status.className}>
          {status.label}
        </Row>
        {order.note !== null && <Row label="หมายเหตุ">{order.note}</Row>}
        {order.discount_type !== null && (
          <>
            <Row label="ยอดก่อนลด" className="tabular-nums">
              ฿{Number(order.subtotal).toFixed(2)}
            </Row>
            <Row
              label={`ส่วนลด${order.discount_type === "percent" ? ` (${Number(order.discount_value)}%)` : ""}`}
              className="tabular-nums text-destructive"
            >
              -฿{Number(order.discount_amount).toFixed(2)}
            </Row>
            {order.discount_reason !== null && <Row label="เหตุผลส่วนลด">{order.discount_reason}</Row>}
          </>
        )}
        {order.status === "cancelled" && (
          <>
            {order.cancel_reason !== null && <Row label="เหตุผลที่ยกเลิก">{order.cancel_reason}</Row>}
            {order.cancelled_at !== null && (
              <Row label="เวลาที่ยกเลิก">{formatDateTime(order.cancelled_at)}</Row>
            )}
          </>
        )}
        {order.status === "refunded" && (
          <>
            {order.refund_reason !== null && <Row label="เหตุผลที่คืนเงิน">{order.refund_reason}</Row>}
            {order.refund_method !== null && (
              <Row label="วิธีคืนเงิน">{PAYMENT_LABELS[order.refund_method] ?? order.refund_method}</Row>
            )}
            {order.refunded_at !== null && (
              <Row label="เวลาที่คืนเงิน">{formatDateTime(order.refunded_at)}</Row>
            )}
          </>
        )}
        {order.status === "unpaid" && (
          <>
            {order.unpaid_reason !== null && (
              <Row label="เหตุผลที่ไม่ได้รับเงิน">{order.unpaid_reason}</Row>
            )}
            {order.unpaid_at !== null && <Row label="เวลาที่แจ้ง">{formatDateTime(order.unpaid_at)}</Row>}
          </>
        )}
        <div className="flex justify-between border-t border-border pt-2 text-lg font-semibold text-sidebar">
          <span>รวมทั้งหมด</span>
          <span className="tabular-nums">฿{Number(order.total).toFixed(2)}</span>
        </div>
        {!isTransfer && order.cash_received !== null && order.change_amount !== null && (
          <>
            <Row label="รับเงิน" className="tabular-nums">
              ฿{Number(order.cash_received).toFixed(2)}
            </Row>
            <Row label="เงินทอน" className="tabular-nums">
              ฿{Number(order.change_amount).toFixed(2)}
            </Row>
          </>
        )}
        {isTransfer && order.status === "completed" && order.transfer_verified_at !== null && (
          <Row label="ตรวจยอดโอนแล้ว" className="text-success">
            {nameOf(order.transfer_verified_by)} · {formatDateTime(order.transfer_verified_at)}
          </Row>
        )}
      </div>

      {/* People */}
      <div className="space-y-2 rounded-xl border bg-white px-4 py-4">
        <h2 className="text-base font-semibold text-sidebar">ผู้ทำรายการ</h2>
        <Row label="ขายโดย">{nameOf(order.created_by)}</Row>
        {order.discount_approved_by !== null && (
          <Row label="อนุมัติส่วนลดโดย">{nameOf(order.discount_approved_by)}</Row>
        )}
        {order.status === "cancelled" && (
          <Row label="ยกเลิกโดย">{withApprover(order.cancelled_by, order.cancelled_approved_by)}</Row>
        )}
        {order.status === "refunded" && (
          <Row label="คืนเงินโดย">{withApprover(order.refunded_by, order.refunded_approved_by)}</Row>
        )}
        {order.status === "unpaid" && (
          <Row label="แจ้งไม่ได้รับเงินโดย">
            {withApprover(order.unpaid_by, order.unpaid_approved_by)}
          </Row>
        )}
        {customer && (
          <Row label="ลูกค้า">
            <Link href={`/customers/${customer.id}`} className="text-accent hover:underline">
              {customer.name}
            </Link>
          </Row>
        )}
      </div>

      {adjustments.length > 0 && (
        <div className="space-y-3 rounded-xl border bg-white px-4 py-4">
          <h2 className="text-base font-semibold text-sidebar">ประวัติการแก้ไขบิล</h2>
          <ol className="space-y-3">
            {adjustments.map((a) => (
              <li key={`${a.kind}-${a.createdAt}`} className="text-base">
                <p className="font-medium text-sidebar">{adjustmentLabel(a)}</p>
                <p className="text-sm text-muted-foreground">
                  {a.reason} · {withApprover(a.actorId, a.approverId)} · {formatDateTime(a.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {heldHistory.length > 0 && (
        <div className="space-y-3 rounded-xl border bg-white px-4 py-4">
          <h2 className="text-base font-semibold text-sidebar">ประวัติบิลพัก</h2>
          <ol className="space-y-2">
            {heldHistory.map((event) => (
              <li key={event.id} className="text-base">
                <p className="text-sidebar">
                  <span className="font-medium">{HELD_EVENT_LABELS[event.eventType]}</span>
                  {event.atPayment && " (ตอนชำระ)"}
                  <span className="text-muted-foreground">
                    {" "}
                    · {event.actorName ?? "—"} · {formatTime(event.createdAt)}
                  </span>
                </p>
                {event.reductions.map((r, i) => (
                  <p key={i} className="pl-3 text-destructive">
                    {r.name}
                    {r.options.length > 0 ? ` (${r.options.join(", ")})` : ""}
                    {r.note ? ` 📝 ${r.note}` : ""}: {r.fromQty} → {r.toQty}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </div>
      )}

      {order.status === "completed" && (
        <div className="space-y-3">
          {isTransfer && isManager && (
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3">
              <span className="text-base text-sidebar">ตรวจยอดโอนกับบัญชีธนาคาร</span>
              <TransferCheckToggle
                orderId={order.id}
                verified={order.transfer_verified_at !== null}
                canEdit
              />
            </div>
          )}
          <ChangeMethodButton
            orderId={order.id}
            currentMethod={order.payment_method}
            shiftOpen={shiftOpen}
          />
          {isTransfer && <MarkUnpaidButton orderId={order.id} />}
          <VoidOrderButton orderId={order.id} />
          <RefundOrderButton orderId={order.id} />
        </div>
      )}

      {order.status === "unpaid" && <RestorePaidButton orderId={order.id} />}
    </div>
  );
}
