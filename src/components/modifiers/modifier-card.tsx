import Link from "next/link";
import { deleteModifier, deleteModifierOption } from "@/app/actions/modifiers";
import type { ModifierWithOptions } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/ui/delete-button";
import { ModifierOptionForm } from "./modifier-option-form";

type Props = {
  modifier: ModifierWithOptions;
  isEditing: boolean;
};

export function ModifierCard({ modifier }: Props) {
  return (
    <div className="rounded-lg border bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sidebar">{modifier.name}</h3>
            {modifier.isRequired && (
              <Badge variant="destructive" className="text-xs">บังคับ</Badge>
            )}
            {modifier.isMultiSelect && (
              <Badge className="text-xs bg-blue-100 text-blue-700">เลือกได้หลายตัว</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            ลำดับ: {modifier.sortOrder} · {modifier.options.length} ตัวเลือก
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/modifiers?action=edit&id=${modifier.id}`}
            className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/20"
          >
            แก้ไข
          </Link>
          <form action={deleteModifier}>
            <input type="hidden" name="id" value={modifier.id} />
            <DeleteButton message={`ลบกลุ่ม "${modifier.name}" และตัวเลือกทั้งหมด?`} />
          </form>
        </div>
      </div>

      {/* Options list */}
      {modifier.options.length > 0 && (
        <div className="rounded-md border divide-y text-sm">
          {modifier.options.map((opt) => (
            <div key={opt.id} className="flex items-center justify-between px-3 py-2">
              <span>
                {opt.name}
                {opt.priceDelta !== 0 && (
                  <span className="ml-1 text-muted-foreground">
                    ({opt.priceDelta > 0 ? "+" : ""}{opt.priceDelta} บาท)
                  </span>
                )}
              </span>
              <form action={deleteModifierOption}>
                <input type="hidden" name="id" value={opt.id} />
                <DeleteButton message={`ลบตัวเลือก "${opt.name}"?`} />
              </form>
            </div>
          ))}
        </div>
      )}

      {/* Add option form */}
      <div className="pt-1 border-t">
        <p className="text-xs font-medium text-muted-foreground mb-2">+ เพิ่มตัวเลือก</p>
        <ModifierOptionForm modifierId={modifier.id} />
      </div>
    </div>
  );
}
