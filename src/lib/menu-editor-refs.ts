import "server-only";
// What the menu editor pages (owner/manager only) need besides the menu itself: materials with their
// current cost, the shop's choice groups, sweetness levels and standard table. Every read goes through
// dal (cost reads sit behind canViewCosts); only plain serialisable shapes leave this file.
import { getArchivedRawMaterials, getChoiceGroups, getRawMaterials, getSweetnessConfig } from "@/lib/dal";
import type { EditorAmount, EditorGroup, EditorLevel, EditorMaterial } from "@/components/products/menu-editor-types";

export type MenuEditorRefs = {
  /** materials in use, by name */
  materials: EditorMaterial[];
  /** archived (ปิดใช้แล้ว) materials, by name — the edit page keeps only the ones its menu still uses */
  archivedMaterials: EditorMaterial[];
  groups: EditorGroup[];
  levels: EditorLevel[];
  standardAmounts: EditorAmount[];
};

export async function loadMenuEditorRefs(tenantId: string): Promise<MenuEditorRefs> {
  const [active, archived, groups, sweetness] = await Promise.all([
    getRawMaterials(tenantId),
    getArchivedRawMaterials(tenantId),
    getChoiceGroups(tenantId),
    getSweetnessConfig(tenantId),
  ]);
  const toEditor = (archivedFlag: boolean) => (m: { id: string; name: string; unit: string; cost_per_unit: number | string }) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    costPerUnit: Number(m.cost_per_unit),
    archived: archivedFlag,
  });
  return {
    materials: active.map(toEditor(false)),
    archivedMaterials: archived.map(toEditor(true)),
    groups,
    levels: sweetness.levels,
    standardAmounts: sweetness.amounts,
  };
}
