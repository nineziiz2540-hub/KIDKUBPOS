"use client";

import { useEffect } from "react";
import { shouldRegisterServiceWorker } from "@/lib/receipt-link";

// Serwist's sw-entry creates window.serwist in production builds only (never in development).
type SerwistHandle = { register(): Promise<unknown> } | undefined;

// Registers the POS service worker on every page except the customer receipt (/r/...).
// Serwist's own auto-register is turned off in next.config.ts.
export function RegisterServiceWorker(): null {
  useEffect(() => {
    if (!shouldRegisterServiceWorker(window.location.pathname)) return;
    const serwist = (window as unknown as { serwist?: SerwistHandle }).serwist;
    if (!serwist) return;
    serwist.register().catch(() => {});
  }, []);
  return null;
}
