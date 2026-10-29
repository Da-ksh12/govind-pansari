-- Follow-up to 20260827000003: the Supabase security advisor flagged
-- is_active_order_status() as "function_search_path_mutable" because the
-- helper was created without a pinned search_path (business_day_start()
-- in the same migration was pinned; this one was missed). The function only
-- compares an enum value, so pinning changes no behaviour.
--
-- Rollback: alter function is_active_order_status(order_status) reset search_path;

alter function is_active_order_status(order_status) set search_path = public;
