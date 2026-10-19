import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProductRowMenu } from "@/components/products/product-row-menu";
import { SearchFilter } from "@/components/ui/search-filter";
import { SavedToastTrigger } from "@/components/products/saved-toast-trigger";
import { ArchivedProductsSection } from "@/components/products/archived-products-section";
import { formatPrice } from "@/lib/cash";
import { cn } from "@/lib/utils";

type ProductRow = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
  categories: { name: string } | null;
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const canManage = profile.role === "owner" || profile.role === "manager";
  const { saved } = await searchParams;

  const supabase = await createClient();
  const [{ data: activeRows }, { data: archived }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, price, is_active, categories(name)")
      .eq("tenant_id", profile.tenant_id)
      .is("archived_at", null)
      .order("name"),
    supabase
      .from("products")
      .select("id, name, price, archived_at")
      .eq("tenant_id", profile.tenant_id)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false }),
  ]);
  const products = activeRows as ProductRow[] | null;
  const archivedProducts = (archived ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    archivedAt: p.archived_at as string,
  }));

  return (
    <div className="space-y-6">
      {saved === "1" && <SavedToastTrigger />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sidebar">สินค้า</h1>
          <p className="text-sm text-muted-foreground mt-1">
            จัดการรายการสินค้าทั้งหมด
          </p>
        </div>
        {canManage && (
          <Link
            href="/products/new"
            className={cn(
              buttonVariants({ variant: "default" }),
              "bg-accent hover:bg-accent/90 text-white"
            )}
          >
            <Plus size={16} className="mr-1" />
            เพิ่มสินค้า
          </Link>
        )}
      </div>

      {products && products.length > 0 ? (
        <SearchFilter placeholder="ค้นหาสินค้า..." emptyMessage="ไม่พบสินค้าที่ค้นหา">
          <div className="rounded-lg border bg-white divide-y divide-border">
            {products.map((product) => (
              <div
                key={product.id}
                data-search-value={product.name}
                className="flex items-center gap-4 px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sidebar truncate">
                    {product.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {product.categories?.name ?? "ไม่ระบุหมวดหมู่"} ·{" "}
                    ฿{formatPrice(Number(product.price))}
                  </p>
                </div>
                <Badge variant={product.is_active ? "default" : "secondary"}>
                  {product.is_active ? "เปิด" : "ปิด"}
                </Badge>
                {canManage && (
                  <ProductRowMenu productId={product.id} productName={product.name} />
                )}
              </div>
            ))}
          </div>
        </SearchFilter>
      ) : (
        <div className="rounded-lg border bg-white divide-y divide-border">
          <p className="px-4 py-8 text-center text-muted-foreground">
            ยังไม่มีสินค้า
          </p>
        </div>
      )}

      {archivedProducts.length > 0 && <ArchivedProductsSection products={archivedProducts} />}
    </div>
  );
}
