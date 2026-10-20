"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import { verifyManagerPin } from "@/lib/manager-pin";
import { adjustmentErrorMessage } from "@/lib/order-adjustment-errors";

// Bill adjustments from ประวัติบิล: mark a transfer as ไม่ได้รับเงิน, restore it, change the
// payment method, and tick เจอเงินแล้ว. Each one runs a service-role-only database function
// (migration 20261021120000_order_adjustments) that locks the bill, checks its state, updates it
// and appends to order_adjustments in one transaction. The functions can't be called with a
// user's session, and a guard trigger rejects the same writes made straight through the Data
// API, so the PIN check here is the only way in.

export type AdjustOrderState = { error?: string; success?: boolean } | undefined;

type PinnedInput = { orderId: string; reason: string; pin: string };

function readPinnedInput(formData: FormData): PinnedInput | { error: string } {
  const orderId = formData.get("order_id");
  const reason = formData.get("reason");
  const pin = formData.get("pin");
  if (typeof orderId !== "string" || typeof reason !== "string" || typeof pin !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (reason.trim() === "") return { error: "กรุณาระบุเหตุผล" };
  if (!/^\d{6}$/.test(pin)) return { error: "PIN ไม่ถูกต้อง" };
  return { orderId, reason: reason.trim(), pin };
}

function revalidateOrder(orderId: string) {
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

export async function markOrderUnpaid(
  prevState: AdjustOrderState,
  formData: FormData
): Promise<AdjustOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const input = readPinnedInput(formData);
  if ("error" in input) return input;

  const approverId = await verifyManagerPin(profile.tenant_id, input.pin);
  if (!approverId) return { error: "PIN ไม่ถูกต้อง" };

  const { error } = await createAdminClient().rpc("order_mark_unpaid", {
    p_tenant_id: profile.tenant_id,
    p_order_id: input.orderId,
    p_actor_id: profile.id,
    p_approver_id: approverId,
    p_reason: input.reason,
  });
  if (error) {
    console.error("[markOrderUnpaid]", error.message);
    return { error: adjustmentErrorMessage(error.message) };
  }

  revalidateOrder(input.orderId);
  return { success: true };
}

export async function restoreOrderPaid(
  prevState: AdjustOrderState,
  formData: FormData
): Promise<AdjustOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const input = readPinnedInput(formData);
  if ("error" in input) return input;

  const approverId = await verifyManagerPin(profile.tenant_id, input.pin);
  if (!approverId) return { error: "PIN ไม่ถูกต้อง" };

  const { error } = await createAdminClient().rpc("order_restore_paid", {
    p_tenant_id: profile.tenant_id,
    p_order_id: input.orderId,
    p_actor_id: profile.id,
    p_approver_id: approverId,
    p_reason: input.reason,
  });
  if (error) {
    console.error("[restoreOrderPaid]", error.message);
    return { error: adjustmentErrorMessage(error.message) };
  }

  revalidateOrder(input.orderId);
  return { success: true };
}

export async function changePaymentMethod(
  prevState: AdjustOrderState,
  formData: FormData
): Promise<AdjustOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const input = readPinnedInput(formData);
  if ("error" in input) return input;

  const toMethod = formData.get("to_method");
  if (toMethod !== "cash" && toMethod !== "transfer") {
    return { error: "ช่องทางชำระไม่ถูกต้อง" };
  }

  const approverId = await verifyManagerPin(profile.tenant_id, input.pin);
  if (!approverId) return { error: "PIN ไม่ถูกต้อง" };

  const { error } = await createAdminClient().rpc("order_change_payment_method", {
    p_tenant_id: profile.tenant_id,
    p_order_id: input.orderId,
    p_to_method: toMethod,
    p_actor_id: profile.id,
    p_approver_id: approverId,
    p_reason: input.reason,
  });
  if (error) {
    console.error("[changePaymentMethod]", error.message);
    return { error: adjustmentErrorMessage(error.message) };
  }

  revalidateOrder(input.orderId);
  revalidatePath("/shifts");
  return { success: true };
}

/** เจอเงินแล้ว tick on a transfer bill. Owner/manager only; no PIN (it changes no money). */
export async function setTransferVerified(
  orderId: string,
  verified: boolean
): Promise<{ error?: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (profile.role !== "owner" && profile.role !== "manager") {
    return { error: "เฉพาะเจ้าของร้านหรือผู้จัดการ" };
  }
  if (typeof orderId !== "string" || typeof verified !== "boolean") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const { error } = await createAdminClient().rpc("order_set_transfer_verified", {
    p_tenant_id: profile.tenant_id,
    p_order_id: orderId,
    p_actor_id: profile.id,
    p_verified: verified,
  });
  if (error) {
    console.error("[setTransferVerified]", error.message);
    return { error: adjustmentErrorMessage(error.message) };
  }

  revalidateOrder(orderId);
  return {};
}
