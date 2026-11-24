import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isReceiptToken } from "@/lib/receipt-link";
import type { ReceiptData } from "@/lib/receipt-view";

/**
 * One receipt_get call per request (React cache): generateMetadata and the page share it.
 * Not a UUID -> null without touching the DB. A DB error is logged by code only (never the
 * token or payload) and shows as "not found".
 */
export const getReceipt = cache(async (token: string): Promise<ReceiptData | null> => {
  if (!isReceiptToken(token)) return null;
  const { data, error } = await createAdminClient().rpc("receipt_get", { p_token: token });
  if (error) {
    console.error("receipt_get failed", error.code);
    return null;
  }
  return (data as unknown as ReceiptData | null) ?? null;
});
