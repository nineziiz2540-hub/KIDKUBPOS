import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createCategory } from "@/app/actions/categories";
import { CategoryForm } from "@/components/categories/category-form";

export default async function NewCategoryPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/categories");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">เพิ่มหมวดหมู่ใหม่</h1>
        <p className="text-sm text-muted-foreground mt-1">
          กรอกชื่อหมวดหมู่สินค้าที่ต้องการเพิ่ม
        </p>
      </div>
      <CategoryForm action={createCategory} />
    </div>
  );
}
