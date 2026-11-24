export const RECEIPT_PATH = "/r/";
export const RECEIPT_QR_CAPTION = "สแกนเก็บใบเสร็จ";
export const RECEIPT_QR_PENDING_NOTE = "เปิดได้หลังบิลขึ้นระบบ";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReceiptToken(s: string): boolean {
  return UUID_RE.test(s);
}

export function receiptUrl(origin: string, clientRef: string): string {
  return origin.replace(/\/$/, "") + RECEIPT_PATH + clientRef;
}

/** The public receipt page must never be taken over by the POS service worker. */
export function shouldRegisterServiceWorker(pathname: string): boolean {
  return !(pathname === "/r" || pathname.startsWith("/r/"));
}
