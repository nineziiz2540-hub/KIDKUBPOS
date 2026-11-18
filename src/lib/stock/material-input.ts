// Pure validation of the material form (round D1). Used by the server action; kept free of
// framework imports so node:test can run it. `get` reads one form field (null when absent).

export type MaterialFields = {
  name: string;
  unit: string;
  cost_per_unit: number;
  min_stock_alert: number;
  category: string;
  purchase_unit: string | null;
  purchase_size: number | null;
  /** undefined = the form did not send it: leave the column unchanged. */
  track_stock?: boolean;
};

const MAX_QTY = 10_000_000;
const MAX_COST = 100_000_000;

export function parseMaterialInput(get: (key: string) => string | null): {
  fields?: MaterialFields;
  error?: string;
} {
  const name = (get("name") ?? "").trim();
  const unit = (get("unit") ?? "").trim();
  const costRaw = get("cost_per_unit");
  const minRaw = get("min_stock_alert");
  const categoryRaw = (get("category") ?? "").trim();
  const purchaseUnitRaw = (get("purchase_unit") ?? "").trim();
  const purchaseSizeRaw = (get("purchase_size") ?? "").trim();

  if (name === "") return { error: "กรุณากรอกชื่อวัตถุดิบ" };
  if (name.length > 100) return { error: "ชื่อยาวเกินไป (ไม่เกิน 100 ตัวอักษร)" };
  if (unit === "") return { error: "กรุณากรอกหน่วย" };
  if (unit.length > 20) return { error: "หน่วยยาวเกินไป (ไม่เกิน 20 ตัวอักษร)" };

  const cost = costRaw !== null && costRaw !== "" ? Number(costRaw) : 0;
  if (!Number.isFinite(cost) || cost < 0 || cost >= MAX_COST) return { error: "กรุณากรอกต้นทุนที่ถูกต้อง" };

  const minStock = minRaw !== null && minRaw !== "" ? Number(minRaw) : 0;
  if (!Number.isFinite(minStock) || minStock < 0 || minStock >= MAX_QTY) {
    return { error: "กรุณากรอกจำนวนเตือนที่ถูกต้อง" };
  }

  if (purchaseUnitRaw.length > 20) return { error: "ชื่อหน่วยซื้อยาวเกินไป (ไม่เกิน 20 ตัวอักษร)" };
  let purchaseSize: number | null = null;
  if (purchaseSizeRaw !== "") {
    purchaseSize = Number(purchaseSizeRaw);
    if (!Number.isFinite(purchaseSize) || purchaseSize <= 0 || purchaseSize >= MAX_QTY) {
      return { error: "กรุณากรอกขนาดที่ซื้อให้ถูกต้อง" };
    }
  }
  const purchaseUnit = purchaseUnitRaw === "" ? null : purchaseUnitRaw;
  if ((purchaseUnit === null) !== (purchaseSize === null)) {
    return { error: "ซื้อเป็น: กรอกทั้งชื่อหน่วยและขนาด หรือเว้นว่างทั้งคู่" };
  }

  const track = get("track_stock");
  return {
    fields: {
      name,
      unit,
      cost_per_unit: cost,
      min_stock_alert: minStock,
      category: categoryRaw === "" ? "วัตถุดิบทั่วไป" : categoryRaw.slice(0, 60),
      purchase_unit: purchaseUnit,
      purchase_size: purchaseSize,
      track_stock: track === "on" ? true : track === "off" ? false : undefined,
    },
  };
}
