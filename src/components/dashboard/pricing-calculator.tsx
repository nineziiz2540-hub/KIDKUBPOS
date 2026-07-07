"use client";

import { useState, useTransition } from "react";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchProductCost } from "@/app/actions/calculator";
import type { CalcProduct } from "@/lib/dal";

type CalcResult = {
  totalVariableCost: number;
  shopPrice: number;
  deliveryPrice: number;
  netProfitShop: number;
  gpShop: number;
};

function compute(
  ingredientCost: number,
  packagingCost: number,
  wastePct: number,
  targetGpPct: number,
  deliveryGpPct: number
): CalcResult | null {
  if (wastePct >= 100 || targetGpPct >= 100 || deliveryGpPct >= 100) return null;
  const totalVariableCost = (ingredientCost + packagingCost) / (1 - wastePct / 100);
  const shopPrice = totalVariableCost / (1 - targetGpPct / 100);
  const deliveryPrice = totalVariableCost / (1 - deliveryGpPct / 100);
  const netProfitShop = shopPrice - totalVariableCost;
  const gpShop = shopPrice > 0 ? (netProfitShop / shopPrice) * 100 : 0;
  return { totalVariableCost, shopPrice, deliveryPrice, netProfitShop, gpShop };
}

export function PricingCalculator({
  products,
  defaultDeliveryGp,
}: {
  products: CalcProduct[];
  defaultDeliveryGp: number;
}) {
  const [productId, setProductId] = useState("");
  const [ingredientCost, setIngredientCost] = useState<number | null>(null);
  const [packagingCost, setPackagingCost] = useState(0);
  const [wastePct, setWastePct] = useState(5);
  const [targetGpPct, setTargetGpPct] = useState(65);
  const [deliveryGpPct, setDeliveryGpPct] = useState(defaultDeliveryGp);
  const [isPending, startTransition] = useTransition();

  function handleProductChange(id: string) {
    setProductId(id);
    setIngredientCost(null);
    if (!id) return;
    startTransition(async () => {
      const cost = await fetchProductCost(id);
      setIngredientCost(cost.ingredientCost);
    });
  }

  const result =
    ingredientCost !== null
      ? compute(ingredientCost, packagingCost, wastePct, targetGpPct, deliveryGpPct)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-sidebar flex items-center gap-2">
          <Calculator size={16} className="text-accent" />
          คำนวณราคาขาย
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Product */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">สินค้า</label>
          <select
            value={productId}
            onChange={(e) => handleProductChange(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm text-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/30"
          >
            <option value="">— เลือกสินค้า —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Ingredient Cost readonly */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            ต้นทุนวัตถุดิบ (฿)
          </label>
          <div className="h-9 rounded-md border border-input bg-muted px-3 flex items-center text-sm tabular-nums text-sidebar">
            {isPending
              ? "กำลังโหลด..."
              : ingredientCost !== null
              ? `฿${ingredientCost.toFixed(2)}`
              : "—"}
          </div>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              {
                label: "ต้นทุนแพ็กเกจจิ้ง (฿)",
                value: packagingCost,
                onChange: setPackagingCost,
                min: 0,
                max: undefined,
                step: "0.5",
              },
              {
                label: "% ของเสีย",
                value: wastePct,
                onChange: setWastePct,
                min: 0,
                max: 99,
                step: "1",
              },
              {
                label: "% GP เป้าหมาย",
                value: targetGpPct,
                onChange: setTargetGpPct,
                min: 1,
                max: 99,
                step: "1",
              },
              {
                label: "% GP เดลิเวอรี่",
                value: deliveryGpPct,
                onChange: setDeliveryGpPct,
                min: 1,
                max: 99,
                step: "1",
              },
            ] as Array<{
              label: string;
              value: number;
              onChange: (v: number) => void;
              min: number;
              max: number | undefined;
              step: string;
            }>
          ).map(({ label, value, onChange, min, max, step }) => (
            <div key={label} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {label}
              </label>
              <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm tabular-nums text-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/30"
              />
            </div>
          ))}
        </div>

        {/* Result */}
        {result !== null && (
          <div className="rounded-lg border border-sidebar/20 bg-sidebar/5 p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              ผลการคำนวณ
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">ต้นทุนรวม</span>
              <span className="font-medium text-sidebar tabular-nums text-right">
                ฿{result.totalVariableCost.toFixed(2)}
              </span>
              <span className="text-muted-foreground">ราคาแนะนำหน้าร้าน</span>
              <span className="font-bold text-sidebar tabular-nums text-right">
                ฿{result.shopPrice.toFixed(2)}
              </span>
              <span className="text-muted-foreground">ราคาเดลิเวอรี่</span>
              <span className="font-bold text-sidebar tabular-nums text-right">
                ฿{result.deliveryPrice.toFixed(2)}
              </span>
              <span className="text-muted-foreground">กำไรสุทธิ/หน่วย</span>
              <span className="font-bold text-accent tabular-nums text-right">
                ฿{result.netProfitShop.toFixed(2)}
              </span>
              <span className="text-muted-foreground">GP หน้าร้าน</span>
              <span className="font-semibold text-green-600 tabular-nums text-right">
                {result.gpShop.toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
