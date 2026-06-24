import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { createProduct } from "@/app/actions/products";
import { ProductForm } from "@/components/products/product-form";

export default async function NewProductPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/products");
  }

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">เพิ่มสินค้าใหม่</h1>
        <p className="text-sm text-muted-foreground mt-1">
          กรอกข้อมูลสินค้าที่ต้องการเพิ่ม
        </p>
      </div>
      <ProductForm action={createProduct} categories={categories ?? []} />
    </div>
  );
}
