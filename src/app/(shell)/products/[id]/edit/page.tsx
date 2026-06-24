import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateProduct } from "@/app/actions/products";
import { ProductForm } from "@/components/products/product-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/products");
  }

  const supabase = await createClient();
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, price, description, is_active, category_id")
      .eq("id", id)
      .single(),
    supabase.from("categories").select("id, name").order("name"),
  ]);

  if (!product) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">แก้ไขสินค้า</h1>
        <p className="text-sm text-muted-foreground mt-1">{product.name}</p>
      </div>
      <ProductForm
        action={updateProduct}
        categories={categories ?? []}
        defaults={{
          id: product.id,
          name: product.name,
          price: Number(product.price),
          description: product.description,
          category_id: product.category_id,
          is_active: product.is_active,
        }}
      />
    </div>
  );
}
