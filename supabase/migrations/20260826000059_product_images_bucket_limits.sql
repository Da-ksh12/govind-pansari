-- Part 23: the 5MB size limit and jpg/png/webp type restriction on
-- product image uploads were only enforced client-side
-- (services/storage/productImages.ts) — exactly the "hidden button"
-- pattern the hardening phase's own rule warns against. Storage.buckets
-- has real server-side enforcement for both; set it so a direct API
-- call bypassing the app is bound by the same limits.
update storage.buckets
set file_size_limit = 5242880, -- 5MB, matches MAX_FILE_BYTES in services/storage/productImages.ts
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'product-images';
