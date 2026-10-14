-- Admin Control Center, part 3: settings (section 37) and feature
-- flags (section 38).
--
-- Deliberately narrow scope: this project already correctly models
-- several things the spec's example list re-mentions at the wrong
-- granularity — delivery serviceability is per-zone (Phase 03's
-- delivery_zones), business hours are per-store (Phase 01's
-- opening_time/closing_time/is_accepting_orders, already surfaced in
-- the store dashboard's pause toggle), and a rider's concurrent-
-- delivery cap is per-rider (max_active_deliveries). None of that is
-- duplicated here as a second, conflicting global value. app_settings
-- holds only what's genuinely global and didn't exist anywhere yet:
-- business display/contact info, plus a few default values new rows
-- can be seeded from (not a live override of already-per-entity data).

create table app_settings (
  id boolean primary key default true, -- singleton: exactly one row, id always true
  business_name text not null default 'Govind Pansari',
  logo_url text,
  support_phone text,
  support_email text,
  default_min_order_value numeric(10, 2) not null default 0 check (default_min_order_value >= 0),
  default_delivery_fee numeric(10, 2) not null default 0 check (default_delivery_fee >= 0),
  default_inventory_reorder_level int not null default 5 check (default_inventory_reorder_level >= 0),
  default_low_stock_threshold int not null default 10 check (default_low_stock_threshold >= 0),
  default_max_active_deliveries int not null default 1 check (default_max_active_deliveries >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  constraint app_settings_singleton check (id = true)
);

insert into app_settings (id) values (true);

create trigger app_settings_set_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

comment on table app_settings is 'Singleton config row (section 37). Business display/contact info and seed defaults only — never a second source of truth for values already modeled per-store/per-zone/per-rider elsewhere.';

alter table app_settings enable row level security;
create policy "app_settings_read" on app_settings for select using (has_permission('settings.view'));
create policy "app_settings_write" on app_settings for update using (has_permission('settings.manage')) with check (has_permission('settings.manage'));

create or replace function update_app_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;

  update app_settings set
    business_name = coalesce(p_patch->>'businessName', business_name),
    logo_url = coalesce(p_patch->>'logoUrl', logo_url),
    support_phone = coalesce(p_patch->>'supportPhone', support_phone),
    support_email = coalesce(p_patch->>'supportEmail', support_email),
    default_min_order_value = coalesce((p_patch->>'defaultMinOrderValue')::numeric, default_min_order_value),
    default_delivery_fee = coalesce((p_patch->>'defaultDeliveryFee')::numeric, default_delivery_fee),
    default_inventory_reorder_level = coalesce((p_patch->>'defaultInventoryReorderLevel')::int, default_inventory_reorder_level),
    default_low_stock_threshold = coalesce((p_patch->>'defaultLowStockThreshold')::int, default_low_stock_threshold),
    default_max_active_deliveries = coalesce((p_patch->>'defaultMaxActiveDeliveries')::int, default_max_active_deliveries),
    updated_by = auth.uid()
  where id = true
  returning to_jsonb(app_settings.*) into v_result;

  perform log_audit_event('settings_changed', 'app_settings', null, p_patch);
  return v_result;
end;
$$;

revoke all on function update_app_settings from public, anon;
grant execute on function update_app_settings to authenticated;

-- ---------------------------------------------------------------------
-- Feature flags (section 38) — prepared infrastructure, nothing in the
-- app branches on these yet. Admin-only visibility; not a public/
-- customer-facing config endpoint.
-- ---------------------------------------------------------------------

create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

insert into feature_flags (key, enabled, description) values
  ('payments_enabled', false, 'Razorpay checkout — explicitly out of scope through Phase 11'),
  ('cod_enabled', true, 'Cash-on-delivery is the only working payment path today'),
  ('promotions_enabled', true, 'Promotional notification category (Phase 10) and future marketing surfaces'),
  ('loyalty_enabled', false, 'Not built yet'),
  ('referrals_enabled', false, 'Not built yet');

create trigger feature_flags_set_updated_at
  before update on feature_flags
  for each row execute function set_updated_at();

alter table feature_flags enable row level security;
create policy "feature_flags_read" on feature_flags for select using (has_permission('settings.view'));
create policy "feature_flags_write" on feature_flags for update using (has_permission('settings.manage')) with check (has_permission('settings.manage'));

create or replace function set_feature_flag(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;
  update feature_flags set enabled = p_enabled, updated_by = auth.uid() where key = p_key;
  if not found then
    raise exception 'unknown feature flag: %', p_key;
  end if;
  perform log_audit_event('feature_flag_changed', 'feature_flags', null, jsonb_build_object('key', p_key, 'enabled', p_enabled));
end;
$$;

revoke all on function set_feature_flag from public, anon;
grant execute on function set_feature_flag to authenticated;
