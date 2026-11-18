// Plain, serialisable props the menu editor pages hand to the client editor (round D1). Types only.

/** A choice group with its members (same shape as dal's ChoiceGroupView). */
export type EditorGroup = {
  id: string;
  kind: "bean" | "matcha" | "sweetener" | "other";
  name: string;
  members: {
    id: string;
    materialId: string;
    materialName: string;
    unit: string;
    label: string;
    tier: "house" | "special";
    priceDelta: number;
    isDefault: boolean;
    archived: boolean;
  }[];
};

/** A material with its current cost: owner/manager pages only. */
export type EditorMaterial = { id: string; name: string; unit: string; costPerUnit: number; archived: boolean };

export type EditorLevel = { id: string; name: string; isNone: boolean; isDefault: boolean };
export type EditorAmount = { member_id: string; level_id: string; amount: number };
