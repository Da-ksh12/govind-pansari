-- A new order_event_type value for "an item marked unavailable was found
-- and put back into picking". Kept in its own migration (and its own
-- transaction) because Postgres will not let a newly added enum value be
-- used in the same transaction that added it — the same split
-- 20260825000022/23 and 20260825000025/26 already follow.
--
-- Rollback: enum values cannot be dropped in Postgres. The value is inert
-- when unused, so no rollback is needed.
alter type order_event_type add value if not exists 'item_reopened';
