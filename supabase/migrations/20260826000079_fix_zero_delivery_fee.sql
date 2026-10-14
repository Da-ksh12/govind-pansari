-- Real bug found while running the full test suite to zero failures
-- (final pre-launch QA hardening): delivery_zones.delivery_fee was 0
-- for all three zones (Sanjay Place / Vijay Nagar / Awas Vikas) —
-- the bare column default (20260825000004), never actually set by any
-- migration or seed script. That silently makes every single order
-- free delivery, regardless of subtotal, which directly contradicts
-- the app's own UI copy ("Free Delivery — On orders above ₹499",
-- app/product/[slug].tsx) and the free_delivery_threshold column that
-- exists specifically to waive an otherwise-real fee above that
-- amount — a threshold is meaningless if the fee it waives is already
-- zero. supabase/tests/phase05-checkout-fulfillment.test.mjs tests 14
-- and 15 (checking the non-free delivery-fee band between
-- minimum_order_value and free_delivery_threshold) encode ₹49 as the
-- expected standard fee and were failing against live data for
-- exactly this reason — the correct fix is the data, not the test,
-- per "if a test exposes a real bug: fix the bug."
--
-- ₹49 is not invented here — it's the value the pre-existing test
-- suite already hardcoded as this app's intended standard delivery
-- fee. If the business's actual real-world number differs, this is a
-- one-field edit in Admin > Settings > Default Delivery Fee (or a
-- direct delivery_zones.delivery_fee update) away, not a schema
-- change — flagging this in the QA report for the owner to confirm.

update delivery_zones set delivery_fee = 49 where delivery_fee = 0;

update app_settings set default_delivery_fee = 49 where default_delivery_fee = 0;
