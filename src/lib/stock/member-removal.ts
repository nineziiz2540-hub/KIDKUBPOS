// Guarded removal of a member from a choice group (round D2a, Task 14 / R38). Pure rules only.

export type RemovalMember = { id: string; tier: "house" | "special"; sortOrder: number; isDefault: boolean };
export type RemovalCtx = {
  /** every member of the group the removed member belongs to (including itself) */
  members: RemovalMember[];
  /** menus whose sweetness uses a member of this group */
  sweetnessUses: { menuName: string; defaultMemberId: string | null; allowedMemberIds: string[] }[];
  /** non-archived menus with a slot line in this group, and the default that line points at */
  slotDefaults: { menuName: string; defaultMemberId: string | null }[];
};
export type RemovalCheck = { ok: true; warn: string | null } | { ok: false; reason: string };

const names = (list: string[]) => Array.from(new Set(list)).join(", ");

export function removalCheck(memberId: string, ctx: RemovalCtx): RemovalCheck {
  const inSweetness = ctx.sweetnessUses.filter(
    (u) => u.defaultMemberId === memberId || u.allowedMemberIds.includes(memberId)
  );
  if (inSweetness.length > 0) {
    return { ok: false, reason: `ใช้อยู่ในความหวานของเมนู: ${names(inSweetness.map((u) => u.menuName))}` };
  }

  const member = ctx.members.find((m) => m.id === memberId);
  if (member?.tier === "house" && ctx.members.filter((m) => m.tier === "house").length <= 1) {
    return { ok: false, reason: "ต้องมีเมล็ดร้านอย่างน้อย 1 ตัว" };
  }

  const asDefault = ctx.slotDefaults.filter((s) => s.defaultMemberId === memberId);
  if (asDefault.length > 0) {
    return {
      ok: true,
      warn: `เป็นค่าเริ่มต้นของเมนู: ${names(asDefault.map((s) => s.menuName))} — ระบบจะใช้ตัวร้านตัวถัดไปแทน`,
    };
  }
  return { ok: true, warn: null };
}

/** The member that becomes the group default when `removedId` (the flagged default) goes; null when nothing moves. */
export function nextDefaultAfterRemoval(members: RemovalMember[], removedId: string): string | null {
  const removed = members.find((m) => m.id === removedId);
  if (!removed?.isDefault) return null;
  const next = members
    .filter((m) => m.id !== removedId && m.tier === "house")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))[0];
  return next?.id ?? null;
}
