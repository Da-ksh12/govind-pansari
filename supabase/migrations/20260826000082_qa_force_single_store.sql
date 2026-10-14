-- QA request: "every order should go to Awas Vikas branch only for
-- testing purpose." Same reversible, flagged philosophy as
-- qa_test_mode (20260826000076) — never a hardcoded rewrite of the
-- real nearest-store logic, just an explicit, off-by-default override
-- that a settings.manage admin can flip on/off, so production behavior
-- (genuine geofenced nearest-store selection across all real stores)
-- is one flag away from being restored, not lost.
--
-- Hooking this into find_serviceable_stores() (rather than
-- resolve_checkout/create_order_from_cart individually) means it
-- consistently affects every caller for free: checkout preview, real
-- order placement, and the "which store serves you" browse/serviceability
-- display all go through this one function already.

insert into feature_flags (key, enabled, description) values
  ('qa_force_awas_vikas', false, 'QA/demo testing: routes every order to the Awas Vikas store only, regardless of customer address/geofencing. Defaults OFF — must be explicitly enabled via set_feature_flag(''qa_force_awas_vikas'', true) by an admin with settings.manage. Never enable in production.')
on conflict (key) do nothing;

create or replace function find_serviceable_stores(customer_lat double precision, customer_lng double precision)
returns table (
  store_id uuid,
  store_name text,
  delivery_zone_id uuid,
  delivery_fee numeric,
  minimum_order_value numeric,
  estimated_delivery_minutes int,
  distance_meters double precision
)
language sql
stable
as $$
  select
    s.id,
    s.name,
    dz.id,
    dz.delivery_fee,
    dz.minimum_order_value,
    dz.estimated_delivery_minutes,
    ST_Distance(s.geog, ST_SetSRID(ST_MakePoint(customer_lng, customer_lat), 4326)::geography)
  from delivery_zones dz
  join store_delivery_zones sdz on sdz.delivery_zone_id = dz.id
  join stores s on s.id = sdz.store_id
  where dz.is_active
    and s.is_active
    and s.is_accepting_orders
    and (
      coalesce((select enabled from feature_flags where key = 'qa_test_mode'), false)
      or (now() at time zone 'Asia/Kolkata')::time between s.opening_time and s.closing_time
    )
    and (
      -- QA override: only Awas Vikas is ever a candidate, and the
      -- normal geofence check is skipped for it — real per-store
      -- is_active/is_accepting_orders/hours gating above still fully
      -- applies, this only widens WHICH address the store will serve.
      (
        coalesce((select enabled from feature_flags where key = 'qa_force_awas_vikas'), false)
        and s.id = '00000000-0000-0000-0000-000000000103'
      )
      or (
        not coalesce((select enabled from feature_flags where key = 'qa_force_awas_vikas'), false)
        and ST_Covers(dz.boundary, ST_SetSRID(ST_MakePoint(customer_lng, customer_lat), 4326)::geography)
      )
    )
  order by sdz.priority asc, 7 asc;
$$;

comment on function find_serviceable_stores is 'Customer location -> zone -> eligible stores, ranked by explicit priority then distance. Does not consider inventory — the caller (checkout, or a "which store has this in stock" browse query) filters further. Excludes stores outside their opening_time/closing_time (IST) UNLESS the qa_test_mode feature flag is on (see 20260826000076). When qa_force_awas_vikas is on (20260826000082), only Awas Vikas is ever returned, regardless of the customer''s actual location.';
