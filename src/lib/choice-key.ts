import type { CartChoices } from "../types/app.ts";

/**
 * The ids that make a choice different for a sale: chosen members per group, and sweetness level +
 * sweetener. Labels and prices are left out (they follow from the ids).
 *
 * Append-only: a slot is `[groupId, memberId]`, then `2` when a special is doubled, then the extra
 * shot's member id when there is one. A line without either keeps its key byte for byte, so its
 * payment fingerprint, outbox key and held-bill identity never change.
 */
export function choiceKey(choices: CartChoices): unknown[] {
  return [
    choices.slots.map((s) => {
      const key: unknown[] = [s.groupId, s.memberId];
      if (s.count === 2) key.push(2);
      if (s.shot) key.push(s.shot.memberId);
      return key;
    }),
    choices.sweetness ? [choices.sweetness.levelId, choices.sweetness.memberId] : null,
  ];
}
