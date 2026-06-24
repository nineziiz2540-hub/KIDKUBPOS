import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateCategory } from "@/app/actions/categories";
import { CategoryForm } from "@/components/categories/category-form";

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/categories");
  }

  const supabase = await createClient();
  const { data: category } = await supabase
    .from("categories")
    .select("id, name")
    .eq("id", id)
    .single();

  if (!category) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">แก้ไขหมวดหมู่</h1>
        <p className="text-sm text-muted-foreground mt-1">{category.name}</p>
      </div>
      <CategoryForm
        action={updateCategory}
        defaultName={category.name}
        id={category.id}
      />
    </div>
  );
}
