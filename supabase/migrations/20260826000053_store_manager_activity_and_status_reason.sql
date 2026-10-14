-- Store Manager phase: two small, additive backend pieces. Everything
-- else this phase needs (order queue, picking, packing, inventory,
-- rider assignment, dashboard, cross-store RLS scoping via
-- is_store_staff()) already existed from Phase 07/08/09/10 — see
-- docs/store-manager-architecture.md for the full inventory of what
-- was reused vs. added here.

-- ---------------------------------------------------------------------
-- 1. A reason for pausing a store (section 7's "Store maintenance"
-- example). Deliberately NOT a new status column — get_store_
-- operational_status() stays derived from is_active/is_accepting_
-- orders/opening_time exactly as Phase 07 designed it; this is just a
-- human-readable note alongside the existing boolean, cleared when the
-- store resumes so it can never show a stale reason for a store that's
-- actually open.
-- ---------------------------------------------------------------------

alter table stores add column status_reason text;

-- A new 3rd parameter (even defaulted) is a different signature to
-- Postgres's overload resolution — CREATE OR REPLACE would leave the
-- old 2-param version as a separate, ambiguous overload rather than
-- replacing it (same gotcha Phase 08's own assign_rider migration
-- hit — see 20260825000030's comment). Drop it explicitly first.
drop function if exists set_store_accepting_orders(uuid, boolean);

create or replace function set_store_accepting_orders(p_store_id uuid, p_accepting boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_store_staff(p_store_id, 'store_manager') or is_admin()) then
    raise exception 'only a store manager can change this store''s operational status';
  end if;
  update stores set is_accepting_orders = p_accepting, status_reason = case when p_accepting then null else p_reason end
    where id = p_store_id;
  perform log_audit_event('store_status_changed', 'stores', p_store_id, jsonb_build_object('accepting', p_accepting, 'reason', p_reason));
end;
$$;

revoke all on function set_store_accepting_orders from public, anon;
grant execute on function set_store_accepting_orders to authenticated;

-- ---------------------------------------------------------------------
-- 2. Store activity feed (section 40) — merges order_events,
-- delivery_events, and inventory_movements, each of which already
-- carries store_id directly (clean, native scoping — no join through
-- audit_logs' heterogeneous resource_type needed). audit_logs itself
-- is the admin-level cross-cutting log (Admin Control Center phase);
-- a store manager's own "what just happened in my outlet" view is
-- better served by these three operational streams, which is exactly
-- what section 40's own example activity lines are drawn from
-- ("started preparing", "rider arrived", "packed", "stock adjusted").
-- ---------------------------------------------------------------------

create or replace function get_store_activity(p_store_id uuid, p_cursor timestamptz default null, p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_store_staff(p_store_id) or is_admin()) then
    raise exception 'not authorized to view this store''s activity';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select at, kind, label, order_number, metadata from (
        select oe.created_at as at, 'order'::text as kind, oe.event_type::text as label, o.order_number, oe.metadata
        from order_events oe join orders o on o.id = oe.order_id
        where oe.store_id = p_store_id
        union all
        select de.created_at as at, 'delivery'::text as kind, de.event_type::text as label, o.order_number, de.metadata
        from delivery_events de join orders o on o.id = de.order_id
        where de.store_id = p_store_id
        union all
        select im.created_at as at, 'inventory'::text as kind,
               (im.movement_type::text || ' (' || (case when im.quantity_change >= 0 then '+' else '' end) || im.quantity_change::text || ')') as label,
               null::text as order_number,
               jsonb_build_object('variantId', im.product_variant_id) as metadata
        from inventory_movements im
        where im.store_id = p_store_id
      ) merged
      where p_cursor is null or at < p_cursor
      order by at desc
      limit least(coalesce(p_limit, 30), 100)
    ) t
  );
end;
$$;

comment on function get_store_activity is 'Store-scoped operational feed (section 40) — order_events + delivery_events + inventory_movements, all natively store_id-scoped, no new activity table.';

revoke all on function get_store_activity from public, anon;
grant execute on function get_store_activity to authenticated;
