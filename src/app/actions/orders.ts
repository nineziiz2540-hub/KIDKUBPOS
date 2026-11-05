"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, getActiveShift } from "@/lib/dal";
import { verifyManagerPin } from "@/lib/manager-pin";
import { computeDiscount } from "@/lib/discount";
import { computeChange, MAX_CASH_RECEIVED, toSatang } from "@/lib/cash";
import { priceCartItems, priceCartItemsAsCharged } from "@/lib/order-pricing";
import { STALE } from "@/lib/order-pricing-core";
import { diffReductions } from "@/lib/held-bill-diff";
import { createFailureOutcome, HELD_BILL_STALE_MESSAGE, OLD_TAB_MESSAGE } from "@/lib/order-create-errors";
import {
  checkOfflineSale,
  classifyRecordError,
  recordErrorMessage,
  REVIEW_MESSAGES,
  type ReviewCode,
  type SyncOutcome,
} from "@/lib/offline/sync-outcome";
import { isValidDateString } from "@/lib/bangkok-time";
import { CONNECTION_RETRY_MESSAGE } from "@/lib/payment-attempt";
import type { CartItem, CreateOrderInput, OfflineSale, SavedOrder } from "@/types/app";
import type { Json } from "@/types/database";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAVE_FAILED_MESSAGE = "บันทึกออเดอร์ไม่สำเร็จ";

/**
 * createOrder's failure. `outcome` is for the device's outbox sender (src/lib/offline/sync-outcome.ts):
 * retry = keep the bill and send it again, review = move it to the manager's review list
 * (`reviewCode` says why), refused = an online sale's problem goes back to the cart.
 * mayHaveSaved: the sale may already be recorded; the POS treats it as "no answer" and offers only
 * a retry of the same attempt (same client_ref, so it can't record twice).
 */
type CreateOrderFailure = {
  error: string;
  outcome: SyncOutcome;
  reviewCode?: ReviewCode;
  mayHaveSaved?: true;
};

function toSavedOrder(row: {
  id: string;
  order_number: string | null;
  queue_number: number | null;
  cash_received: number | null;
  change_amount: number | null;
}): SavedOrder {
  return {
    orderId: row.id,
    orderNumber: row.order_number ?? "",
    queueNumber: row.queue_number ?? 0,
    cashReceived: row.cash_received === null ? null : Number(row.cash_received),
    changeAmount: row.change_amount === null ? null : Number(row.change_amount),
  };
}

/**
 * Records a sale. data.clientRef identifies this payment attempt (the POS keeps it across
 * retries of the same cart): if a bill with it already exists, that bill is returned as a
 * success before any other check, so a retry after a lost response can never record the sale
 * twice. Every write happens in one transaction in order_record (migration 20261105120000).
 *
 * data.offline: a bill sold in device-numbered mode, sent later by the device's outbox. It keeps
 * its seller, sale time, queue number and shift. data.override: "record as charged" from the
 * manager's review list — the device's prices are kept, approved by an owner/manager PIN.
 */
export async function createOrder(
  data: CreateOrderInput
): Promise<CreateOrderFailure | SavedOrder> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน", outcome: "retry" };

  if (typeof data.clientRef !== "string" || !UUID_RE.test(data.clientRef)) {
    return { error: OLD_TAB_MESSAGE, outcome: "retry" };
  }

  // 0. Replay first: a bill already saved under this attempt is the answer, whatever has changed
  // since (its held bill is now paid, its shift may have closed).
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("orders")
    .select("id, order_number, queue_number, cash_received, change_amount")
    .eq("tenant_id", profile.tenant_id)
    .eq("client_ref", data.clientRef)
    .maybeSingle();
  if (existing) return toSavedOrder(existing);

  // 0b. An offline bill: only ever recorded in the shop it was sold in (a bill of another shop
  // waits, spec call 7), under the seller saved with it.
  let offline: OfflineSale | null = null;
  if (data.offline !== undefined) {
    const checked = checkOfflineSale(data.offline, profile.tenant_id);
    if (!("ok" in checked)) return checked;
    offline = checked.sale;
  }
  const actorId = offline ? offline.sellerId : profile.id;

  /** A definite problem with this bill: manager review when offline, back to the cart online. */
  const stop = (error: string, reviewCode: ReviewCode = "other"): CreateOrderFailure =>
    offline
      ? { error: reviewCode === "other" ? error : REVIEW_MESSAGES[reviewCode], outcome: "review", reviewCode }
      : { error, outcome: "refused" };

  // 0c. "Record as charged": an active owner/manager of this shop approves the bill as charged.
  let override: { approverId: string; reason: string } | null = null;
  if (data.override !== undefined) {
    if (!offline) return { error: "ข้อมูลไม่ถูกต้อง", outcome: "refused" };
    const pin = data.override?.approverPin;
    const reason = typeof data.override?.reason === "string" ? data.override.reason.trim() : "";
    if (reason === "" || reason.length > 500) {
      return { error: "กรุณาระบุเหตุผล (ไม่เกิน 500 ตัวอักษร)", outcome: "refused" };
    }
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
      return { error: "PIN ไม่ถูกต้อง", outcome: "refused" };
    }
    const approverId = await verifyManagerPin(profile.tenant_id, pin);
    if (!approverId) return { error: "PIN ไม่ถูกต้อง", outcome: "refused" };
    override = { approverId, reason };
  }

  const supabase = await createClient();

  // 1-2. Re-price every line from the database — client prices are never trusted (see
  // priceCartItems). Product/category/modifier names in the snapshot also come from the DB.
  // The one exception is an approved override, which keeps the device's line totals.
  const priced = override
    ? await priceCartItemsAsCharged(supabase, profile.tenant_id, data.items)
    : await priceCartItems(supabase, profile.tenant_id, data.items);
  if ("error" in priced) {
    if (priced.retry) return { error: priced.error, outcome: "retry" };
    if (priced.error === "product_missing") {
      return stop(REVIEW_MESSAGES.product_missing, "product_missing");
    }
    return stop(priced.error, priced.error === STALE ? "menu_changed" : "other");
  }
  const subtotal = priced.subtotal;
  const serverSubtotal: number | null =
    "serverSubtotal" in priced && typeof priced.serverSubtotal === "number" ? priced.serverSubtotal : null;

  // 3. Resolve and validate the discount, if any
  let discountType: "percent" | "amount" | null = null;
  let discountValue: number | null = null;
  let discountReason: string | null = null;
  let discountAmount = 0;
  let requiresApproval = false;

  if (data.discountType !== undefined) {
    if (data.discountType !== "percent" && data.discountType !== "amount") {
      return stop("ส่วนลดไม่ถูกต้อง");
    }
    const value = data.discountValue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return stop("ส่วนลดไม่ถูกต้อง");
    }
    if (data.discountType === "percent" && value > 100) {
      return stop("ส่วนลดไม่ถูกต้อง");
    }
    if (data.discountType === "amount" && value > subtotal) {
      return stop("ส่วนลดมากกว่ายอดรวม");
    }

    const computed = computeDiscount(subtotal, data.discountType, value);
    discountType = data.discountType;
    discountValue = value;
    discountAmount = computed.discountAmount;
    requiresApproval = computed.requiresApproval;

    // Under an override the manager's reason also explains a discount that crossed the threshold.
    const reason = (data.discountReason ?? "").trim() || (override?.reason ?? "");
    if (requiresApproval && reason === "") {
      return stop("กรุณาระบุเหตุผลสำหรับส่วนลดนี้", "needs_approval");
    }
    discountReason = reason !== "" ? reason : null;
  }

  const total = subtotal - discountAmount;

  // 3b. Validate cash tendered against the server-computed total — never trust a change amount
  // from the client. orders_cash_tendered_check re-enforces the same arithmetic in the database.
  let cashReceived: number | null = null;
  let changeAmount: number | null = null;
  if (data.paymentMethod === "cash") {
    if (typeof data.cashReceived !== "number") {
      // The only way the real UI reaches this is a POS tab still running pre-update code (it
      // has no cash modal), so the message tells the cashier how to get unstuck.
      return stop("กรุณารีเฟรชหน้า POS แล้วลองใหม่ (ระบบเพิ่งอัปเดตการรับเงินสด)");
    }
    if (!Number.isFinite(data.cashReceived) || data.cashReceived > MAX_CASH_RECEIVED) {
      return stop("จำนวนเงินที่รับมาไม่ถูกต้อง");
    }
    const change = computeChange(total, data.cashReceived);
    if (change === null) {
      return stop("จำนวนเงินที่รับมาน้อยกว่ายอดชำระ");
    }
    cashReceived = toSatang(data.cashReceived) / 100;
    changeAmount = change;
  } else if (data.cashReceived !== undefined) {
    return stop("ข้อมูลการชำระเงินไม่ถูกต้อง");
  }

  // 4. PIN-verify a Manager/Owner approver when the discount crosses the threshold. An override's
  // approver already covers it. An offline bill never carries a PIN (it is never stored on the
  // device), so one that now needs approval goes to review.
  let approverId: string | null = requiresApproval && override ? override.approverId : null;
  if (requiresApproval && !override) {
    const pin = data.approverPin;
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
      return stop("PIN ไม่ถูกต้อง", "needs_approval");
    }

    const { data: approvers } = await admin
      .from("profiles")
      .select("id, pin_hash")
      .eq("tenant_id", profile.tenant_id)
      .in("role", ["owner", "manager"])
      .not("pin_hash", "is", null);

    for (const approver of approvers ?? []) {
      if (approver.pin_hash && (await bcrypt.compare(pin, approver.pin_hash))) {
        approverId = approver.id;
        break;
      }
    }
    if (!approverId) return stop("PIN ไม่ถูกต้อง", "needs_approval");
  }

  // 4b. Paying a held bill: its items are read only to audit reductions made right before paying.
  // order_record re-checks it is still open at the loaded version, under a row lock.
  let reductions: ReturnType<typeof diffReductions> = [];
  if (data.heldBillId !== undefined) {
    if (typeof data.heldBillId !== "string" || typeof data.heldBillVersion !== "number") {
      return stop("ข้อมูลบิลพักไม่ถูกต้อง");
    }
    const { data: row, error: rowError } = await admin
      .from("held_bills")
      .select("items")
      .eq("id", data.heldBillId)
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle();
    // A failed read is not a stale bill: an offline bill must not go to review over a blip.
    if (rowError) return { error: SAVE_FAILED_MESSAGE, outcome: "retry" };
    if (!row) return stop(HELD_BILL_STALE_MESSAGE, "held_bill_stale");
    reductions = diffReductions(row.items as unknown as CartItem[], data.items);
  }

  // Pre-rounded to satang so the stored total is exactly the one change was computed from (the
  // column is numeric(10,2) and would round it the same way anyway).
  const chargedTotal = toSatang(total) / 100;
  // What the catalog would charge today for the same discount; logged with an override.
  const serverTotal =
    serverSubtotal === null
      ? null
      : toSatang(
          serverSubtotal - computeDiscount(serverSubtotal, discountType, discountValue ?? 0).discountAmount
        ) / 100;

  // 5-8. One transaction: order/queue numbers, the order (attached to the open shift — cash needs
  // one, guard_order_drawer refuses it otherwise), its items, and the held-bill close-out. An
  // offline bill keeps its sale time, queue number and recorded shift (see order_record).
  const { data: rows, error: createError } = await admin.rpc("order_record", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: actorId,
    p_client_ref: data.clientRef,
    p_order: {
      payment_method: data.paymentMethod,
      order_type: data.orderType,
      subtotal,
      total: chargedTotal,
      cash_received: cashReceived,
      change_amount: changeAmount,
      discount_type: discountType,
      discount_value: discountValue,
      discount_amount: discountAmount,
      discount_reason: discountReason,
      discount_approved_by: approverId,
      customer_id: data.customerId ?? null,
      note: data.note ?? null,
    },
    p_items: priced.lines.map((line) => ({
      product_id: line.productId,
      product_name: line.productName,
      unit_price: line.unitPrice,
      quantity: line.quantity,
      subtotal: line.lineTotal,
      category_name: line.categoryName,
      modifiers_snapshot: line.modifiersSnapshot,
      note: line.note,
    })) as unknown as Json,
    p_held_bill_id: data.heldBillId ?? null,
    p_held_bill_version: data.heldBillVersion ?? null,
    p_held_reductions: reductions as unknown as Json,
    p_offline: offline
      ? {
          sold_at: offline.soldAt,
          queue_number: offline.queueNumber,
          shift_id: offline.shiftId,
          override: override
            ? {
                approver_id: override.approverId,
                reason: override.reason,
                server_total: serverTotal,
                charged_total: chargedTotal,
              }
            : null,
        }
      : null,
  });
  const created = rows?.[0];
  if (createError || !created) {
    const raw = createError?.message ?? "no row returned";
    const sqlState = createError?.code;
    const known = recordErrorMessage(raw, sqlState);
    if (known !== null) {
      const { outcome, reviewCode } = classifyRecordError(raw, { offline: offline !== null, sqlState });
      if (reviewCode) {
        return { error: reviewCode === "other" ? known : REVIEW_MESSAGES[reviewCode], outcome, reviewCode };
      }
      return { error: known, outcome };
    }
    console.error("[createOrder] order_record failed:", raw);
    // Not one of ours (e.g. the connection to the database dropped): the transaction may still
    // have committed, so look the bill up again before giving a definite answer.
    const { data: recheck, error: recheckError } = await admin
      .from("orders")
      .select("id, order_number, queue_number, cash_received, change_amount")
      .eq("tenant_id", profile.tenant_id)
      .eq("client_ref", data.clientRef)
      .maybeSingle();
    const outcome = createFailureOutcome(raw, recheckError ? null : recheck !== null);
    if (outcome === "replay" && recheck) return toSavedOrder(recheck);
    if (outcome === "maybe") {
      return { error: CONNECTION_RETRY_MESSAGE, outcome: "retry", mayHaveSaved: true };
    }
    // Unknown and not saved: shown in the cart online; the sender tries again (its try cap moves
    // a bill that keeps failing to review).
    return { error: SAVE_FAILED_MESSAGE, outcome: "retry" };
  }

  if (created.created) {
    // 9. Deduct stock (best-effort — don't block on failure). Only for a new bill: a replay's
    // stock was deducted when it was first saved.
    const { error: deductError } = await supabase.rpc("deduct_stock_for_order", {
      p_order_id: created.order_id,
    });
    if (deductError) {
      console.error("[createOrder] deduct_stock_for_order failed:", deductError.message);
    }
    if (data.heldBillId !== undefined) revalidatePath("/pos");
    revalidatePath("/orders");
  }

  return toSavedOrder({
    id: created.order_id,
    order_number: created.order_number,
    queue_number: created.queue_number,
    cash_received: created.cash_received,
    change_amount: created.change_amount,
  });
}

/**
 * Whether the payment attempt `clientRef` was saved — asked by the POS when a payment ended
 * without an answer (lost connection) and the cashier closes the payment window. Scoped to the
 * caller's own shop by RLS and by the tenant filter.
 */
export async function checkOrderSaved(
  clientRef: string
): Promise<({ saved: true } & Omit<SavedOrder, "orderId">) | { saved: false } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (typeof clientRef !== "string" || !UUID_RE.test(clientRef)) return { saved: false };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("orders")
    .select("id, order_number, queue_number, cash_received, change_amount")
    .eq("tenant_id", profile.tenant_id)
    .eq("client_ref", clientRef)
    .maybeSingle();
  if (error) return { error: "ตรวจสอบบิลไม่สำเร็จ" };
  if (!row) return { saved: false };
  const saved = toSavedOrder(row);
  return {
    saved: true,
    orderNumber: saved.orderNumber,
    queueNumber: saved.queueNumber,
    cashReceived: saved.cashReceived,
    changeAmount: saved.changeAmount,
  };
}

/**
 * Raises the shop's queue counter for `businessDate` (Bangkok YYYY-MM-DD) to at least
 * `queueNumber`. The device calls it when a pending bill is moved to review, so later server
 * queue numbers can't clash with that bill's device number (spec call 2).
 */
export async function raiseQueueCounter(
  businessDate: string,
  queueNumber: number
): Promise<{ ok: true } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (typeof businessDate !== "string" || !isValidDateString(businessDate)) {
    return { error: "วันที่ไม่ถูกต้อง" };
  }
  if (!Number.isInteger(queueNumber) || queueNumber < 1 || queueNumber > 9999) {
    return { error: "เลขคิวไม่ถูกต้อง" };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("queue_counter_raise", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_business_date: businessDate,
    p_queue_number: queueNumber,
  });
  if (error) {
    console.error("[raiseQueueCounter] queue_counter_raise failed:", error.message);
    return { error: "ปรับเลขคิวไม่สำเร็จ" };
  }
  return { ok: true };
}

export type VoidOrderState = { error?: string; success?: boolean } | undefined;

export async function voidOrder(
  prevState: VoidOrderState,
  formData: FormData
): Promise<VoidOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const orderId = formData.get("order_id");
  const reason = formData.get("reason");
  const pin = formData.get("pin");

  if (
    typeof orderId !== "string" ||
    typeof reason !== "string" ||
    typeof pin !== "string"
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (reason.trim() === "") {
    return { error: "กรุณาระบุเหตุผล" };
  }
  if (!/^\d{6}$/.test(pin)) {
    return { error: "PIN ไม่ถูกต้อง" };
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, shift_id")
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!order) return { error: "ไม่พบบิลนี้" };
  if (order.status === "cancelled") return { error: "บิลนี้ถูกยกเลิกไปแล้ว" };
  if (order.status === "refunded") return { error: "บิลนี้ถูกคืนเงินไปแล้ว ไม่สามารถยกเลิกได้" };
  if (order.status === "unpaid") return { error: "บิลนี้ถูกแจ้งว่าไม่ได้รับเงิน" };

  const activeShift = await getActiveShift(profile.tenant_id);
  if (!activeShift || order.shift_id !== activeShift.id) {
    return { error: "ยกเลิกได้เฉพาะบิลในกะที่เปิดอยู่ตอนนี้" };
  }

  const approverId = await verifyManagerPin(profile.tenant_id, pin);
  if (!approverId) return { error: "PIN ไม่ถูกต้อง" };

  const admin = createAdminClient();

  // Written via the admin client, not the regular one: orders_update_own_tenant RLS has no
  // WITH CHECK, so any tenant member could otherwise PATCH status/cancelled_* directly through
  // the Data API and skip this PIN check entirely. A BEFORE UPDATE trigger
  // (prevent_direct_order_void) rejects this exact write from any caller whose auth.uid() is
  // non-null — i.e. everyone except this service_role call — so the trigger and this client
  // choice must be changed together.
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: profile.id,
      cancelled_approved_by: approverId,
      cancel_reason: reason.trim(),
    })
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "completed")
    .select("id");

  if (updateError || !updated || updated.length === 0) {
    if (!updateError) {
      // 0 rows with no error means the status/tenant/id filter didn't match — most likely
      // someone else's concurrent void already won the race, not a real failure.
      const { data: recheck } = await admin
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();
      if (recheck?.status === "cancelled") {
        return { error: "บิลนี้ถูกยกเลิกไปแล้ว" };
      }
    }
    console.error(
      "voidOrder: failed to update order:",
      updateError ?? "update matched 0 rows (row missing or tenant mismatch)"
    );
    return { error: "ยกเลิกบิลไม่สำเร็จ" };
  }

  // Also via the admin client: restock_for_voided_order's EXECUTE grant was revoked from
  // authenticated/anon so it can't be called directly (and looped) through the Data API to
  // inflate stock without ever actually voiding an order.
  const { error: restockError } = await admin.rpc("restock_for_voided_order", {
    p_order_id: orderId,
  });
  if (restockError) {
    console.error(
      "[voidOrder] restock_for_voided_order failed:",
      restockError.message
    );
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { success: true };
}

export type RefundOrderState = { error?: string; success?: boolean } | undefined;

export async function refundOrder(
  prevState: RefundOrderState,
  formData: FormData
): Promise<RefundOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const orderId = formData.get("order_id");
  const refundMethod = formData.get("refund_method");
  const reason = formData.get("reason");
  const pin = formData.get("pin");

  if (
    typeof orderId !== "string" ||
    typeof refundMethod !== "string" ||
    typeof reason !== "string" ||
    typeof pin !== "string"
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (refundMethod !== "cash" && refundMethod !== "transfer") {
    return { error: "กรุณาเลือกวิธีคืนเงิน" };
  }
  if (reason.trim() === "") {
    return { error: "กรุณาระบุเหตุผล" };
  }
  if (!/^\d{6}$/.test(pin)) {
    return { error: "PIN ไม่ถูกต้อง" };
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!order) return { error: "ไม่พบบิลนี้" };
  if (order.status === "cancelled") {
    return { error: "บิลนี้ถูกยกเลิกไปแล้ว ไม่สามารถคืนเงินได้" };
  }
  if (order.status === "refunded") return { error: "บิลนี้ถูกคืนเงินไปแล้ว" };
  if (order.status === "unpaid") return { error: "บิลนี้ถูกแจ้งว่าไม่ได้รับเงิน" };

  const activeShift = await getActiveShift(profile.tenant_id);
  if (refundMethod === "cash" && !activeShift) {
    return { error: "ต้องเปิดกะก่อนจึงจะคืนเงินสดได้" };
  }

  const approverId = await verifyManagerPin(profile.tenant_id, pin);
  if (!approverId) return { error: "PIN ไม่ถูกต้อง" };

  const admin = createAdminClient();

  // The PIN-verification loop above does a bcrypt comparison against every Manager/Owner in the
  // tenant, which can take a noticeable moment. If another device closes the shift fetched into
  // activeShift during that gap, tagging the refund to the stale activeShift.id would send the
  // cash into a shift whose expected_cash/variance were already snapshotted and reconciled by
  // shift_close — the closed shift's summary would never show it. Re-fetch immediately before the
  // write and use this fresh result for refund_shift_id instead of the earlier activeShift.
  // (Migration B's guard_order_drawer also rejects a cash refund tagged to a closed shift.)
  const shiftAtWrite = await getActiveShift(profile.tenant_id);
  if (refundMethod === "cash" && !shiftAtWrite) {
    return { error: "ต้องเปิดกะก่อนจึงจะคืนเงินสดได้" };
  }

  // Written via the admin client from the start (unlike voidOrder's original commit, which
  // needed a later fix): orders_update_own_tenant RLS has no WITH CHECK, so any tenant member
  // could otherwise PATCH the refund_* columns directly through the Data API. The
  // prevent_direct_order_refund trigger rejects this exact write from any caller whose
  // auth.uid() is non-null — i.e. everyone except this service_role call — so the trigger and
  // this client choice must be changed together.
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      refunded_by: profile.id,
      refunded_approved_by: approverId,
      refund_reason: reason.trim(),
      refund_method: refundMethod,
      refund_shift_id: shiftAtWrite?.id ?? null,
    })
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "completed")
    .select("id");

  if (updateError || !updated || updated.length === 0) {
    if (!updateError) {
      // 0 rows with no error means the status/tenant/id filter didn't match — most likely
      // someone else's concurrent void/refund already won the race, not a real failure.
      const { data: recheck } = await admin
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();
      if (recheck?.status === "cancelled") {
        return { error: "บิลนี้ถูกยกเลิกไปแล้ว ไม่สามารถคืนเงินได้" };
      }
      if (recheck?.status === "refunded") {
        return { error: "บิลนี้ถูกคืนเงินไปแล้ว" };
      }
    }
    console.error(
      "refundOrder: failed to update order:",
      updateError ?? "update matched 0 rows (row missing or tenant mismatch)"
    );
    return { error: "คืนเงินไม่สำเร็จ" };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { success: true };
}
