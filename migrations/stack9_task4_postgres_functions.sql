-- Stack 9 Task 4: Postgres Functions
-- Creates two functions:
--   1. generate_order_number(p_tenant_id uuid) -> text
--      Atomically increments tenants.order_sequence and returns e.g. "KK.001"
--   2. deduct_stock_for_order(p_order_id uuid) -> void
--      Reads order_items JOIN product_recipes, deducts raw_materials.current_stock,
--      inserts inventory_transactions rows

-- ============================================================
-- FUNCTION: generate_order_number
-- ============================================================
CREATE OR REPLACE FUNCTION generate_order_number(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  seq int;
  prefix text;
BEGIN
  UPDATE tenants
  SET order_sequence = order_sequence + 1
  WHERE id = p_tenant_id
  RETURNING order_sequence, order_prefix INTO seq, prefix;

  IF seq IS NULL THEN
    RAISE EXCEPTION 'Tenant not found: %', p_tenant_id;
  END IF;

  RETURN prefix || '.' || LPAD(seq::text, 3, '0');
END;
$$;

-- ============================================================
-- FUNCTION: deduct_stock_for_order
-- ============================================================
CREATE OR REPLACE FUNCTION deduct_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  r record;
  tenant uuid;
BEGIN
  SELECT tenant_id INTO tenant FROM orders WHERE id = p_order_id;

  IF tenant IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  FOR r IN
    SELECT
      oi.product_id,
      oi.quantity        AS order_qty,
      pr.raw_material_id,
      pr.quantity_used
    FROM order_items oi
    JOIN product_recipes pr
      ON pr.product_id = oi.product_id
     AND pr.tenant_id  = tenant
    WHERE oi.order_id = p_order_id
  LOOP
    UPDATE raw_materials
    SET
      current_stock = GREATEST(0, current_stock - (r.quantity_used * r.order_qty)),
      updated_at    = now()
    WHERE id = r.raw_material_id;

    INSERT INTO inventory_transactions
      (tenant_id, raw_material_id, type, quantity, note)
    VALUES
      (tenant,
       r.raw_material_id,
       'deduct',
       -(r.quantity_used * r.order_qty),
       'Auto-deduct from order ' || p_order_id::text);
  END LOOP;
END;
$$;

-- ============================================================
-- ROLLBACK
-- DROP FUNCTION IF EXISTS deduct_stock_for_order(uuid);
-- DROP FUNCTION IF EXISTS generate_order_number(uuid);
-- ============================================================
