// What the POS's heartbeat (src/components/pos/use-heartbeat.ts) decides, kept pure so the rules
// that stop the banners from crying wolf can be unit-tested. navigator.onLine alone can't tell
// "Wi-Fi connected but no internet", so the POS asks the server every HEARTBEAT_INTERVAL_MS.

export type Connectivity = { status: "online" | "offline"; failures: number };

export const INITIAL_CONNECTIVITY: Connectivity = { status: "online", failures: 0 };
/** Failed checks in a row before the red bar shows; one slow request must not trigger it. */
export const OFFLINE_AFTER_FAILURES = 2;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 5_000;
/** Re-check delay after a failed check on a page that has never reached the server. */
export const FIRST_RECHECK_MS = 3_000;

/**
 * When to check again after a failed check, if sooner than the interval. "online" is only the
 * starting assumption of a freshly loaded page (e.g. reloaded while offline): until the server
 * has answered once, a failure is re-checked within seconds so the verdict doesn't take 30 s.
 * A page that has reached the server keeps the slow pace, so one dropped request never turns
 * the bar red.
 */
export function recheckAfterFailureMs(s: { failures: number; everSucceeded: boolean }): number | null {
  return !s.everSucceeded && s.failures < OFFLINE_AFTER_FAILURES ? FIRST_RECHECK_MS : null;
}

/**
 * The yellow "เน็ตกลับมาแล้ว — กำลังส่ง" bar. It claims the connection is back, so it waits for
 * the server to have answered once (confirmed); before that the page only assumes it is online.
 */
export function showSyncingBar(s: {
  offline: boolean;
  confirmed: boolean;
  sending: boolean;
  pendingCount: number;
}): boolean {
  return !s.offline && s.confirmed && (s.sending || s.pendingCount > 0);
}

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

/** How long a finished sale's numbers and change stay on screen before an auto-reload may clear them. */
export const RESULT_HOLD_MS = 60_000;

/**
 * Reload for a new version only when nothing on the POS can be lost or missed: a sale's result
 * (order number, change) younger than RESULT_HOLD_MS is still being read, and reloading while
 * offline would land on a page that can't load.
 */
export function canAutoReload(s: {
  cartCount: number;
  heldLoaded: boolean;
  anyDialogOpen: boolean;
  paymentUnresolved: boolean;
  /** Age of the result on screen; null when none is shown. */
  resultAgeMs: number | null;
  online: boolean;
}): boolean {
  return (
    s.cartCount === 0 &&
    !s.heldLoaded &&
    !s.anyDialogOpen &&
    !s.paymentUnresolved &&
    (s.resultAgeMs === null || s.resultAgeMs >= RESULT_HOLD_MS) &&
    s.online
  );
}

/**
 * The heartbeat's JSON. `promptpayId` is undefined when the server left it out (its read failed),
 * so the POS keeps the last value it had instead of blanking the QR. `shiftId` (the open shift,
 * null for none) and `queue` (today's Bangkok date and last queue number) follow the same rule:
 * undefined means "not read this time", keep what you know.
 */
export function parseHeartbeatBody(body: unknown): {
  version: string | undefined;
  promptpayId: string | null | undefined;
  shiftId: string | null | undefined;
  queue: { date: string; last: number } | undefined;
} {
  if (typeof body !== "object" || body === null) {
    return { version: undefined, promptpayId: undefined, shiftId: undefined, queue: undefined };
  }
  const b = body as { version?: unknown; promptpayId?: unknown; shiftId?: unknown; queue?: unknown };
  const q = b.queue as { date?: unknown; last?: unknown } | null | undefined;
  return {
    version: typeof b.version === "string" ? b.version : undefined,
    promptpayId:
      !("promptpayId" in b) ? undefined : typeof b.promptpayId === "string" ? b.promptpayId : null,
    shiftId: !("shiftId" in b) ? undefined : typeof b.shiftId === "string" ? b.shiftId : null,
    queue:
      typeof q === "object" &&
      q !== null &&
      typeof q.date === "string" &&
      typeof q.last === "number" &&
      Number.isInteger(q.last) &&
      q.last >= 0
        ? { date: q.date, last: q.last }
        : undefined,
  };
}

/** Whether the server runs a different build than this page; a dev build never counts. */
export function isNewVersion(pageVersion: string, serverVersion: string): boolean {
  return pageVersion !== "dev" && serverVersion !== "dev" && pageVersion !== serverVersion;
}
