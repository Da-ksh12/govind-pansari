-- Follow-up to 20260826000056: subscribeToAdminCatalogue() also
-- listens on product_variants (a price/SKU edit on a variant doesn't
-- touch the parent products row), which was missed when products/
-- categories were added to the publication in the same migration —
-- same silent-no-op trap as riders/inventory in 20260826000055.
alter publication supabase_realtime add table product_variants;
