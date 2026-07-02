-- Stack 9 Task 5: Setup product-images Storage Bucket
-- Creates a public Storage bucket for product images with authenticated write policies.
-- Public read is handled automatically by the public bucket setting.

-- ============================================================
-- Part A: Create bucket
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Part B: Storage policies (authenticated write access)
-- ============================================================

CREATE POLICY "authenticated_upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "authenticated_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images');

CREATE POLICY "authenticated_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'product-images');

-- ============================================================
-- Rollback (run manually if needed)
-- ============================================================

-- DROP POLICY IF EXISTS "authenticated_upload" ON storage.objects;
-- DROP POLICY IF EXISTS "authenticated_update" ON storage.objects;
-- DROP POLICY IF EXISTS "authenticated_delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'product-images';
