import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PosScreen } from "@/components/pos/pos-screen";

type ProductRow = {
  id: string;
  name: string;
  price: number;
  categories: { name: string } | null;
};

export default async function PosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: products } = (await supabase
    .from("products")
    .select("id, name, price, categories(name)")
    .eq("is_active", true)
    .order("name")) as { data: ProductRow[] | null };

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">POS</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          คลิกสินค้าเพื่อเพิ่มลงตะกร้า
        </p>
      </div>
      <PosScreen products={products ?? []} />
    </div>
  );
}
