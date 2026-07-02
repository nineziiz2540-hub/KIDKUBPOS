-- Stack 9 Fix: Allow all tenant members to UPDATE tenants row
-- Required for generate_order_number (SECURITY INVOKER) to work for staff/manager users.
-- Without this, only owners can pass the existing "owners can update their tenant name" policy
-- → generate_order_number raises "Tenant not found" for non-owner callers creating orders.
-- Application-level role checks in server actions still guard settings mutations.
-- Applied: 2026-07-02

-- UP
CREATE POLICY "tenant_members_can_update"
ON tenants FOR UPDATE
USING (id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
WITH CHECK (id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- DOWN (rollback)
-- DROP POLICY "tenant_members_can_update" ON tenants;
