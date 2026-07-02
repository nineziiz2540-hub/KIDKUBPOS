export type SelectedModifier = {
  modifierId: string;
  modifierName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
};

export type CartItem = {
  productId: string;
  name: string;
  basePrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  totalPrice: number; // (basePrice + sum(priceDelta)) * quantity
};

export type CreateOrderInput = {
  items: CartItem[];
  paymentMethod: "cash" | "transfer" | "card";
  orderType: "dine_in" | "take_away";
  tableNumber?: string;
  customerId?: string;
  note?: string;
};

export type ProductCost = {
  productId: string;
  ingredientCost: number;
  recipes: {
    materialName: string;
    unit: string;
    quantityUsed: number;
    costPerUnit: number;
    lineCost: number;
  }[];
};

export type LowStockAlert = {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  minStockAlert: number;
};

export type ModifierWithOptions = {
  id: string;
  name: string;
  isRequired: boolean;
  isMultiSelect: boolean;
  sortOrder: number;
  options: {
    id: string;
    name: string;
    priceDelta: number;
    sortOrder: number;
  }[];
};
