"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, getActiveShift, getShiftSummary } from "@/lib/dal";
import {
  MAX_COUNT,
  MAX_FLOAT,
  NOTE_MAX,
  compareCount,
  validateMovement,
  type CountComparison,
  type MovementReason,
} from "@/lib/shift-math";
import { shiftErrorMessage } from "@/lib/shift-errors";
import { toSatang } from "@/lib/cash";

// Shift (จัดการกะ) steps: blind opening and closing counts, cash in/out of the drawer and closing
// with the overnight float. Each write runs a service-role-only database function (migration
// 20261022120000_shift_management) that locks the shift row, so counts, movements and closing
// can't interleave. The functions can't be called with a user's session; these actions are the
// only way in.

type Failure = { error: string };

function revalidateShifts() {
  revalidatePath("/shifts");
  revalidatePath("/pos");
}

/** A baht amount 0..max with at most 2 decimals (the database rejects anything finer). */
function isAmount(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    toSatang(value) <= toSatang(max) &&
    Math.abs(value * 100 - toSatang(value)) < 1e-6
  );
}

function readNote(note: unknown): string | null | Failure {
  if (note === null || note === undefined) return null;
  if (typeof note !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX) return { error: `หมายเหตุยาวเกิน ${NOTE_MAX} ตัวอักษร` };
  return trimmed === "" ? null : trimmed;
}

function isFailure(v: unknown): v is Failure {
  return typeof v === "object" && v !== null && "error" in v;
}

/**
 * Morning count check, before the shift exists: what the count is compared with (the float the
 * last closed shift left in the drawer) and the difference. Stateless — see the design's "Known
 * limitations": that float is not a secret.
 */
export async function checkOpeningCount(
  amount: number
): Promise<Failure | { expected: number | null; difference: CountComparison }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (!isAmount(amount, MAX_COUNT)) return { error: "จำนวนเงินไม่ถูกต้อง" };

  const { data: prev } = await createAdminClient()
    .from("shifts")
    .select("float_left")
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "closed")
    .order("closed_at", { ascending: false, nullsFirst: false })
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const expected = prev?.float_left === null || prev?.float_left === undefined
    ? null
    : Number(prev.float_left);
  return { expected, difference: compareCount(amount, expected) };
}

/** Open a shift from the morning count, or [first count, recount] after a mismatch. */
export async function startShift(
  counts: number[],
  note: string | null
): Promise<Failure | { shiftId: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (
    !Array.isArray(counts) ||
    counts.length < 1 ||
    counts.length > 2 ||
    !counts.every((c) => isAmount(c, MAX_COUNT))
  ) {
    return { error: "จำนวนเงินไม่ถูกต้อง" };
  }
  const cleanNote = readNote(note);
  if (isFailure(cleanNote)) return cleanNote;

  const { data, error } = await createAdminClient().rpc("shift_open", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_counts: counts,
    p_note: cleanNote,
  });
  if (error || !data) {
    console.error("[startShift]", error?.message);
    return { error: shiftErrorMessage(error?.message ?? "") };
  }

  revalidateShifts();
  return { shiftId: data };
}

/** Record one closing count (before anything is shown) and return how it compares. */
export async function recordClosingCount(
  shiftId: string,
  amount: number
): Promise<
  Failure | { attempt: number; counted: number; expected: number; difference: CountComparison }
> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (typeof shiftId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (!isAmount(amount, MAX_COUNT)) return { error: "จำนวนเงินไม่ถูกต้อง" };

  const { data, error } = await createAdminClient().rpc("shift_record_closing_count", {
    p_tenant_id: profile.tenant_id,
    p_shift_id: shiftId,
    p_actor_id: profile.id,
    p_amount: amount,
  });
  const row = data?.[0];
  if (error || !row) {
    console.error("[recordClosingCount]", error?.message);
    return { error: shiftErrorMessage(error?.message ?? "") };
  }

  const expected = Number(row.expected);
  revalidatePath("/shifts");
  return {
    attempt: row.attempt,
    counted: amount,
    expected,
    difference: compareCount(amount, expected),
  };
}

/** Close the shift with its latest count, leaving `floatLeft` in the drawer for tomorrow. */
export async function finishShift(
  shiftId: string,
  floatLeft: number,
  note: string | null
): Promise<
  Failure | { counted: number; expected: number; variance: number; floatLeft: number; deposit: number }
> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (typeof shiftId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (!isAmount(floatLeft, MAX_FLOAT)) return { error: "เงินทอนที่เก็บไว้ไม่ถูกต้อง" };
  const cleanNote = readNote(note);
  if (isFailure(cleanNote)) return cleanNote;

  const { data, error } = await createAdminClient().rpc("shift_close", {
    p_tenant_id: profile.tenant_id,
    p_shift_id: shiftId,
    p_actor_id: profile.id,
    p_float_left: floatLeft,
    p_note: cleanNote,
  });
  const row = data?.[0];
  if (error || !row) {
    console.error("[finishShift]", error?.message);
    return { error: shiftErrorMessage(error?.message ?? "") };
  }

  revalidateShifts();
  revalidatePath("/shifts/history");
  return {
    counted: Number(row.counted),
    expected: Number(row.expected),
    variance: Number(row.variance),
    floatLeft: Number(row.float_left),
    deposit: Number(row.deposit),
  };
}

/** Cash put into or taken out of the drawer (no PIN — the user's decision). */
export async function addCashMovement(input: {
  shiftId: string;
  direction: "in" | "out";
  reason: MovementReason;
  amount: number;
  note: string;
}): Promise<Failure | { id: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.shiftId !== "string" ||
    typeof input.note !== "string"
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  const invalid = validateMovement(input);
  if (invalid) return { error: invalid };

  const { data, error } = await createAdminClient().rpc("shift_add_cash_movement", {
    p_tenant_id: profile.tenant_id,
    p_shift_id: input.shiftId,
    p_actor_id: profile.id,
    p_direction: input.direction,
    p_reason: input.reason,
    p_amount: input.amount,
    p_note: input.note.trim() === "" ? null : input.note.trim(),
  });
  if (error || !data) {
    console.error("[addCashMovement]", error?.message);
    return { error: shiftErrorMessage(error?.message ?? "") };
  }

  revalidatePath("/shifts");
  return { id: data };
}

// ── Old open/close, removed in round B Task 5 once the new /shifts page replaces ShiftPanel ──

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
  const { data: updated, error } = await supabase
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
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return { error: "ปิดกะไม่สำเร็จ (กะอาจถูกปิดไปแล้ว)" };
  }

  revalidatePath("/shifts");
  revalidatePath("/pos");
  return { variance };
}
