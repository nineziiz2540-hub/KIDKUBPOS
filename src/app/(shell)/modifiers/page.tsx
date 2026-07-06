import Link from "next/link";
import { redirect } from "next/navigation";
import { Sliders } from "lucide-react";
import { getProfile, getModifiers } from "@/lib/dal";
import { createModifier, updateModifier } from "@/app/actions/modifiers";
import { ModifierForm } from "@/components/modifiers/modifier-form";
import { ModifierCard } from "@/components/modifiers/modifier-card";

export default async function ModifiersPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; id?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const { action, id } = await searchParams;
  const modifiers = await getModifiers(profile.tenant_id);

  const editTarget =
    action === "edit" && id
      ? (modifiers.find((m) => m.id === id) ?? null)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sidebar flex items-center gap-2">
            <Sliders size={24} />
            ตัวเลือกเพิ่มเติม (Modifiers)
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            จัดการกลุ่มตัวเลือกสำหรับสินค้า เช่น ความหวาน, ท็อปปิ้ง
          </p>
        </div>
        {action !== "new" && (
          <Link
            href="/modifiers?action=new"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            + เพิ่มกลุ่มตัวเลือก
          </Link>
        )}
      </div>

      {/* Create form */}
      {action === "new" && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">เพิ่มกลุ่มตัวเลือกใหม่</h2>
          <ModifierForm action={createModifier} />
        </div>
      )}

      {/* Edit form */}
      {editTarget && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">แก้ไข: {editTarget.name}</h2>
          <ModifierForm action={updateModifier} defaults={editTarget} />
        </div>
      )}

      {/* Modifier cards */}
      {modifiers.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-muted-foreground">
          ยังไม่มีกลุ่มตัวเลือก — กด &quot;เพิ่มกลุ่มตัวเลือก&quot; เพื่อเริ่มต้น
        </div>
      ) : (
        <div className="grid gap-4">
          {modifiers.map((mod) => (
            <ModifierCard
              key={mod.id}
              modifier={mod}
              isEditing={editTarget?.id === mod.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
