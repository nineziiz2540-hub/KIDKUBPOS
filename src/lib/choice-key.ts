import type { CartChoices } from "../types/app.ts";

/**
 * The ids that make a choice different for a sale: chosen members per group, and sweetness level +
 * sweetener. Labels and prices are left out (they follow from the ids).
 */
export function choiceKey(choices: CartChoices): unknown[] {
  return [
    choices.slots.map((s) => [s.groupId, s.memberId]),
    choices.sweetness ? [choices.sweetness.levelId, choices.sweetness.memberId] : null,
  ];
}
