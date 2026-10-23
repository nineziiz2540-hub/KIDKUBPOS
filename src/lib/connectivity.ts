// What the POS's heartbeat (src/components/pos/use-heartbeat.ts) decides, kept pure so the rules
// that stop the banners from crying wolf can be unit-tested. navigator.onLine alone can't tell
// "Wi-Fi connected but no internet", so the POS asks the server every HEARTBEAT_INTERVAL_MS.

export type Connectivity = { status: "online" | "offline"; failures: number };

export const INITIAL_CONNECTIVITY: Connectivity = { status: "online", failures: 0 };
/** Failed checks in a row before the red bar shows; one slow request must not trigger it. */
export const OFFLINE_AFTER_FAILURES = 2;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 5_000;

export function nextConnectivity(
  state: Connectivity,
  event: "success" | "failure" | "browser-offline"
): Connectivity {
  if (event === "success") return INITIAL_CONNECTIVITY;
  if (event === "browser-offline") return { status: "offline", failures: state.failures + 1 };
  const failures = state.failures + 1;
  return { status: failures >= OFFLINE_AFTER_FAILURES ? "offline" : state.status, failures };
}

/**
 * A heartbeat fetch that resolved. A signed-out device is redirected to /login (an HTML page):
 * the network is fine, so it counts as success for the banner — the page's own actions will
 * send the cashier to the login screen.
 */
export function classifyHeartbeat(res: {
  ok: boolean;
  redirected: boolean;
  contentType: string | null;
}): "online" | "signed-out" | "failure" {
  if (!res.ok) return "failure";
  if (res.redirected || !(res.contentType ?? "").includes("application/json")) return "signed-out";
  return "online";
}

/** Reload for a new version only when nothing on the POS can be lost. */
export function canAutoReload(s: {
  cartCount: number;
  heldLoaded: boolean;
  anyDialogOpen: boolean;
  paymentUnresolved: boolean;
}): boolean {
  return s.cartCount === 0 && !s.heldLoaded && !s.anyDialogOpen && !s.paymentUnresolved;
}

/** Whether the server runs a different build than this page; a dev build never counts. */
export function isNewVersion(pageVersion: string, serverVersion: string): boolean {
  return pageVersion !== "dev" && serverVersion !== "dev" && pageVersion !== serverVersion;
}
