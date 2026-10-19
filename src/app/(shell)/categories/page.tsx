import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { CategoryList } from "@/components/categories/category-list";

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const canManage = profile.role === "owner" || profile.role === "manager";
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("tenant_id", profile.tenant_id)
    .order("sort_order")
    .order("name");

  return (
    <div className="space-y-4">
      {error === "1" && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-base font-medium text-destructive">
          ลบหมวดหมู่ไม่สำเร็จ
        </p>
      )}
      <CategoryList categories={categories ?? []} canManage={canManage} />
    </div>
  );
}
