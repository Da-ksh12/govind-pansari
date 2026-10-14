-- Phase 03 tests 20-23: inactive zone / inactive store / store not
-- accepting orders are each correctly excluded from serviceability,
-- and multiple eligible stores can be returned together. Uses
-- throwaway rows far from every real seed zone (see TEST_LAT/LNG
-- below), wrapped in a single transaction that's rolled back at the
-- end regardless of outcome — nothing here is ever actually persisted,
-- real demo data is never at risk.
--
-- Run: supabase db query --linked --file supabase/tests/phase03-zone-checks.sql
-- A clean run prints nothing but "PASS" lines; any RAISE EXCEPTION
-- means a real failure (and still leaves no residue, thanks to the
-- rollback).

begin;

-- Point far from every real store's ~4km buffer (Agra) — safe to
-- surround with test-only zones without overlapping real ones.
-- 27.50, 78.50 is ~40km from the seeded Agra stores.

do $$
declare
  v_point geography := ST_SetSRID(ST_MakePoint(78.50, 27.50), 4326)::geography;
  v_result jsonb;
begin
  -- ---- Test 20: inactive zone is ignored ----
  insert into stores (id, name, code, address_line, city, latitude, longitude, is_active, is_accepting_orders)
  values ('99999999-0000-0000-0000-000000000020', 'Test Store 20', 'TEST-20', 'Test', 'Test City', 27.50, 78.50, true, true);
  insert into delivery_zones (id, name, boundary, is_active, delivery_fee, minimum_order_value, estimated_delivery_minutes)
  values ('99999999-0000-0000-0000-00000000a0a0', 'Test Zone 20 (inactive)',
          ST_Multi(ST_Buffer(v_point, 2000)::geometry)::geography(multipolygon, 4326), false, 0, 0, 30);
  insert into store_delivery_zones (store_id, delivery_zone_id, priority)
  values ('99999999-0000-0000-0000-000000000020', '99999999-0000-0000-0000-00000000a0a0', 0);

  v_result := check_serviceability(27.50, 78.50);
  if (v_result->>'serviceable')::boolean is not false then
    raise exception 'Test 20 FAILED: inactive zone should make this unserviceable, got %', v_result;
  end if;
  raise notice 'Test 20 PASS: inactive zone correctly ignored';

  delete from store_delivery_zones where store_id = '99999999-0000-0000-0000-000000000020';
  delete from delivery_zones where id = '99999999-0000-0000-0000-00000000a0a0';
  delete from stores where id = '99999999-0000-0000-0000-000000000020';

  -- ---- Test 21: inactive store is ignored (zone itself is active) ----
  insert into stores (id, name, code, address_line, city, latitude, longitude, is_active, is_accepting_orders)
  values ('99999999-0000-0000-0000-000000000021', 'Test Store 21', 'TEST-21', 'Test', 'Test City', 27.50, 78.50, false, true);
  insert into delivery_zones (id, name, boundary, is_active, delivery_fee, minimum_order_value, estimated_delivery_minutes)
  values ('99999999-0000-0000-0000-00000000a1a1', 'Test Zone 21',
          ST_Multi(ST_Buffer(v_point, 2000)::geometry)::geography(multipolygon, 4326), true, 0, 0, 30);
  insert into store_delivery_zones (store_id, delivery_zone_id, priority)
  values ('99999999-0000-0000-0000-000000000021', '99999999-0000-0000-0000-00000000a1a1', 0);

  v_result := check_serviceability(27.50, 78.50);
  if (v_result->>'serviceable')::boolean is not false then
    raise exception 'Test 21 FAILED: inactive store should make this unserviceable, got %', v_result;
  end if;
  raise notice 'Test 21 PASS: inactive store correctly ignored';

  delete from store_delivery_zones where store_id = '99999999-0000-0000-0000-000000000021';
  delete from delivery_zones where id = '99999999-0000-0000-0000-00000000a1a1';
  delete from stores where id = '99999999-0000-0000-0000-000000000021';

  -- ---- Test 22: store not accepting orders is ignored ----
  insert into stores (id, name, code, address_line, city, latitude, longitude, is_active, is_accepting_orders)
  values ('99999999-0000-0000-0000-000000000022', 'Test Store 22', 'TEST-22', 'Test', 'Test City', 27.50, 78.50, true, false);
  insert into delivery_zones (id, name, boundary, is_active, delivery_fee, minimum_order_value, estimated_delivery_minutes)
  values ('99999999-0000-0000-0000-00000000a2a2', 'Test Zone 22',
          ST_Multi(ST_Buffer(v_point, 2000)::geometry)::geography(multipolygon, 4326), true, 0, 0, 30);
  insert into store_delivery_zones (store_id, delivery_zone_id, priority)
  values ('99999999-0000-0000-0000-000000000022', '99999999-0000-0000-0000-00000000a2a2', 0);

  v_result := check_serviceability(27.50, 78.50);
  if (v_result->>'serviceable')::boolean is not false then
    raise exception 'Test 22 FAILED: store not accepting orders should make this unserviceable, got %', v_result;
  end if;
  raise notice 'Test 22 PASS: store not accepting orders correctly ignored';

  delete from store_delivery_zones where store_id = '99999999-0000-0000-0000-000000000022';
  delete from delivery_zones where id = '99999999-0000-0000-0000-00000000a2a2';
  delete from stores where id = '99999999-0000-0000-0000-000000000022';

  -- ---- Test 23: multiple eligible stores can be returned together ----
  insert into stores (id, name, code, address_line, city, latitude, longitude, is_active, is_accepting_orders)
  values
    ('99999999-0000-0000-0000-000000000023', 'Test Store 23a', 'TEST-23A', 'Test', 'Test City', 27.50, 78.50, true, true),
    ('99999999-0000-0000-0000-000000000024', 'Test Store 23b', 'TEST-23B', 'Test', 'Test City', 27.51, 78.51, true, true);
  insert into delivery_zones (id, name, boundary, is_active, delivery_fee, minimum_order_value, estimated_delivery_minutes)
  values ('99999999-0000-0000-0000-00000000a3a3', 'Test Zone 23',
          ST_Multi(ST_Buffer(v_point, 5000)::geometry)::geography(multipolygon, 4326), true, 0, 0, 30);
  insert into store_delivery_zones (store_id, delivery_zone_id, priority) values
    ('99999999-0000-0000-0000-000000000023', '99999999-0000-0000-0000-00000000a3a3', 0),
    ('99999999-0000-0000-0000-000000000024', '99999999-0000-0000-0000-00000000a3a3', 1);

  v_result := check_serviceability(27.50, 78.50);
  if (v_result->>'serviceable')::boolean is not true or jsonb_array_length(v_result->'eligibleStores') < 2 then
    raise exception 'Test 23 FAILED: expected >=2 eligible stores, got %', v_result;
  end if;
  raise notice 'Test 23 PASS: multiple eligible stores returned (%)', jsonb_array_length(v_result->'eligibleStores');
end $$;

rollback;
