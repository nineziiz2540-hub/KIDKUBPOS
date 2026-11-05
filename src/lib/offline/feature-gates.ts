// Which POS features are usable given connectivity and the unsent-bill queue.
export type Gate = { enabled: true } | { enabled: false; reason: string };

export type GateFeature =
  | "pin_discount"
  | "hold"
  | "resume_held"
  | "member"
  | "shift"
  | "switch_user"
  | "navigate"
  | "save_to_device";

export function gate(
  feature: GateFeature,
  s: { online: boolean; pendingCount: number; attemptHasPinDiscount?: boolean },
): Gate {
  // The save-to-device button is the fallback when the network is out or an answer was lost,
  // so only a PIN discount (which needs the server) disables it.
  if (feature === "save_to_device") {
    return s.attemptHasPinDiscount
      ? { enabled: false, reason: "ส่วนลดที่ใช้ PIN ต้องรอเน็ต" }
      : { enabled: true };
  }
  if (!s.online) return { enabled: false, reason: "ใช้ไม่ได้ตอนเน็ตหลุด" };
  if (s.pendingCount > 0 && feature !== "navigate" && feature !== "switch_user") {
    return { enabled: false, reason: "รอส่งบิลค้างให้ครบก่อน" };
  }
  return { enabled: true };
}
