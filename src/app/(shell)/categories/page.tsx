import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { deleteCategory } from "@/app/actions/categories";
import { buttonVariants } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";
import { cn } from "@/lib/utils";

export default async function CategoriesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const canManage = profile.role === "owner" || profile.role === "manager";

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sidebar">หมวดหมู่สินค้า</h1>
          <p className="text-sm text-muted-foreground mt-1">
            จัดการหมวดหมู่สินค้าของร้านค้า
          </p>
        </div>
        {canManage && (
          <Link
            href="/categories/new"
            className={cn(
              buttonVariants({ variant: "default" }),
              "bg-accent hover:bg-accent/90 text-white"
            )}
          >
            <Plus size={16} className="mr-1" />
            เพิ่มหมวดหมู่
          </Link>
        )}
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {categories && categories.length > 0 ? (
          categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <span className="font-medium text-sidebar">{cat.name}</span>
              {canManage && (
                <div className="flex gap-2">
                  <Link
                    href={`/categories/${cat.id}/edit`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    แก้ไข
                  </Link>
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={cat.id} />
                    <DeleteButton message={`ลบหมวดหมู่ "${cat.name}"?`} />
                  </form>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="px-4 py-8 text-center text-muted-foreground">
            ยังไม่มีหมวดหมู่
          </p>
        )}
      </div>
    </div>
  );
}
