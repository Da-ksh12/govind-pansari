-- Admin management of the home-screen banners and offers, and of the delivery pricing zones.
--
-- Until now these tables could only be changed with SQL (writes were limited to the owner account by row-level security, and no screen existed).
-- Writes still go through checked, audited functions — the tables' own policies are not loosened. Needs the permissions added by 20260829000003.
--
-- Zones are what customers actually pay: resolve_checkout() charges the zone's delivery fee, applies its minimum order and gives free delivery above
-- its threshold. (The two "default" price fields in app_settings are read by nothing.) Zone BOUNDARIES are not editable here: serviceability is decided
-- by distance from the store (max_delivery_radius_km), not by the drawn polygon.
--
-- Not included on purpose: coupons. No checkout function applies a coupon today ("Promo codes aren't available yet"), so a coupons screen would edit
-- something with no effect. See docs/roles-and-permissions.md.

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Reads (include inactive and scheduled items, which the public policies hide)
-- ---------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_get_promotions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('promotions.manage') then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'banners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'title', b.title, 'subtitle', b.subtitle, 'eyebrow', b.eyebrow, 'imageUrl', b.image_url, 'ctaLabel', b.cta_label, 'theme', b.theme,
        'targetType', b.target_type, 'targetId', b.target_id, 'targetUrl', b.target_url,
        'targetName', case b.target_type when 'category' then (select c.name from categories c where c.id = b.target_id) when 'product' then (select p.name from products p where p.id = b.target_id) end,
        'startAt', b.start_at, 'endAt', b.end_at, 'sortOrder', b.sort_order, 'isActive', b.is_active) order by b.sort_order, b.created_at)
      from banners b), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'subtitle', o.subtitle, 'imageUrl', o.image_url, 'ctaLabel', o.cta_label, 'category', o.category,
        'targetType', o.target_type, 'targetId', o.target_id,
        'targetName', case o.target_type when 'category' then (select c.name from categories c where c.id = o.target_id) when 'product' then (select p.name from products p where p.id = o.target_id) end,
        'startAt', o.start_at, 'endAt', o.end_at, 'sortOrder', o.sort_order, 'isActive', o.is_active) order by o.sort_order, o.created_at)
      from offers o), '[]'::jsonb));
end;
$$;

create or replace function public.admin_get_zones()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('zones.manage') then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', z.id, 'name', z.name, 'deliveryFee', z.delivery_fee, 'minimumOrderValue', z.minimum_order_value,
      'freeDeliveryThreshold', z.free_delivery_threshold, 'estimatedMinutes', z.estimated_delivery_minutes, 'isActive', z.is_active,
      'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'isActive', s.is_active) order by s.name)
                          from store_delivery_zones sz join stores s on s.id = sz.store_id where sz.delivery_zone_id = z.id), '[]'::jsonb)
    ) order by z.name)
    from delivery_zones z), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Banners
-- ---------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_banner(
  p_id uuid,
  p_title text,
  p_subtitle text,
  p_eyebrow text,
  p_image_url text,
  p_cta_label text,
  p_theme text,
  p_target_type banner_target_type,
  p_target_id uuid,
  p_target_url text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_sort_order integer,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_title text := btrim(coalesce(p_title, ''));
  v_subtitle text := nullif(btrim(coalesce(p_subtitle, '')), '');
  v_eyebrow text := nullif(btrim(coalesce(p_eyebrow, '')), '');
  v_cta text := coalesce(nullif(btrim(coalesce(p_cta_label, '')), ''), 'Shop now');
  v_image text := btrim(coalesce(p_image_url, ''));
  v_theme text := coalesce(nullif(btrim(coalesce(p_theme, '')), ''), 'dark');
  v_url text := nullif(btrim(coalesce(p_target_url, '')), '');
  v_start timestamptz := coalesce(p_start_at, now());
  v_type banner_target_type := coalesce(p_target_type, 'none');
begin
  if not has_permission('promotions.manage') then
    raise exception 'not authorized';
  end if;
  if char_length(v_title) not between 1 and 80 then raise exception 'the title must be 1 to 80 characters'; end if;
  if char_length(coalesce(v_subtitle, '')) > 140 then raise exception 'the subtitle can be at most 140 characters'; end if;
  if char_length(coalesce(v_eyebrow, '')) > 24 then raise exception 'the small heading can be at most 24 characters'; end if;
  if char_length(v_cta) > 24 then raise exception 'the button text can be at most 24 characters'; end if;
  if v_image !~ '^https://[^ ]+$' or char_length(v_image) > 500 then raise exception 'add a picture (an https web address)'; end if;
  if v_theme not in ('dark', 'light') then raise exception 'the theme must be dark or light'; end if;
  if p_end_at is not null and p_end_at <= v_start then raise exception 'the end must be after the start'; end if;
  if coalesce(p_sort_order, 0) not between 0 and 1000 then raise exception 'the order number must be between 0 and 1000'; end if;

  if v_type = 'product' then
    if p_target_id is null or not exists (select 1 from products where id = p_target_id) then raise exception 'choose the product this banner opens'; end if;
    v_url := null;
  elsif v_type = 'category' then
    if p_target_id is null or not exists (select 1 from categories where id = p_target_id) then raise exception 'choose the category this banner opens'; end if;
    v_url := null;
  elsif v_type = 'url' then
    -- one leading "/" and then a real path: "//host" (a web address in disguise), "/./" and ".." are refused
    if v_url is null or v_url !~ '^/([A-Za-z0-9_?=&-][A-Za-z0-9/_?=&.-]*)?$' or v_url like '%..%' or char_length(v_url) > 200 then
      raise exception 'the link must be a page inside the app, like /category/almonds';
    end if;
  else
    v_type := 'none';
    v_url := null;
  end if;

  if v_id is null then
    insert into banners (title, subtitle, eyebrow, image_url, cta_label, theme, target_type, target_id, target_url, start_at, end_at, sort_order, is_active)
    values (v_title, v_subtitle, v_eyebrow, v_image, v_cta, v_theme, v_type, case when v_type in ('product', 'category') then p_target_id end, v_url, v_start, p_end_at,
            coalesce(p_sort_order, 0), coalesce(p_is_active, true))
    returning id into v_id;
    perform log_audit_event('banner_created', 'banner', v_id, jsonb_build_object('title', v_title));
  else
    update banners set title = v_title, subtitle = v_subtitle, eyebrow = v_eyebrow, image_url = v_image, cta_label = v_cta, theme = v_theme,
           target_type = v_type, target_id = case when v_type in ('product', 'category') then p_target_id end, target_url = v_url,
           start_at = v_start, end_at = p_end_at, sort_order = coalesce(p_sort_order, 0), is_active = coalesce(p_is_active, is_active)
     where id = v_id;
    if not found then raise exception 'banner not found'; end if;
    perform log_audit_event('banner_updated', 'banner', v_id, jsonb_build_object('title', v_title));
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_save_offer(
  p_id uuid,
  p_title text,
  p_subtitle text,
  p_image_url text,
  p_cta_label text,
  p_category text,
  p_target_type banner_target_type,
  p_target_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_sort_order integer,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_title text := btrim(coalesce(p_title, ''));
  v_subtitle text := nullif(btrim(coalesce(p_subtitle, '')), '');
  v_cta text := nullif(btrim(coalesce(p_cta_label, '')), '');
  v_image text := btrim(coalesce(p_image_url, ''));
  v_start timestamptz := coalesce(p_start_at, now());
  v_type banner_target_type := coalesce(p_target_type, 'none');
begin
  if not has_permission('promotions.manage') then
    raise exception 'not authorized';
  end if;
  if char_length(v_title) not between 1 and 80 then raise exception 'the title must be 1 to 80 characters'; end if;
  if char_length(coalesce(v_subtitle, '')) > 140 then raise exception 'the subtitle can be at most 140 characters'; end if;
  if char_length(coalesce(v_cta, '')) > 24 then raise exception 'the button text can be at most 24 characters'; end if;
  if v_image !~ '^https://[^ ]+$' or char_length(v_image) > 500 then raise exception 'add a picture (an https web address)'; end if;
  if p_category is null or p_category not in ('first_order', 'combo', 'festival', 'free_delivery', 'premium', 'gifting') then raise exception 'choose what kind of offer this is'; end if;
  if p_end_at is not null and p_end_at <= v_start then raise exception 'the end must be after the start'; end if;
  if coalesce(p_sort_order, 0) not between 0 and 1000 then raise exception 'the order number must be between 0 and 1000'; end if;
  if v_type = 'product' then
    if p_target_id is null or not exists (select 1 from products where id = p_target_id) then raise exception 'choose the product this offer opens'; end if;
  elsif v_type = 'category' then
    if p_target_id is null or not exists (select 1 from categories where id = p_target_id) then raise exception 'choose the category this offer opens'; end if;
  else
    v_type := 'none';
  end if;

  if v_id is null then
    insert into offers (title, subtitle, image_url, cta_label, category, target_type, target_id, start_at, end_at, sort_order, is_active)
    values (v_title, v_subtitle, v_image, v_cta, p_category, v_type, case when v_type in ('product', 'category') then p_target_id end, v_start, p_end_at,
            coalesce(p_sort_order, 0), coalesce(p_is_active, true))
    returning id into v_id;
    perform log_audit_event('offer_created', 'offer', v_id, jsonb_build_object('title', v_title));
  else
    update offers set title = v_title, subtitle = v_subtitle, image_url = v_image, cta_label = v_cta, category = p_category, target_type = v_type,
           target_id = case when v_type in ('product', 'category') then p_target_id end, start_at = v_start, end_at = p_end_at,
           sort_order = coalesce(p_sort_order, 0), is_active = coalesce(p_is_active, is_active)
     where id = v_id;
    if not found then raise exception 'offer not found'; end if;
    perform log_audit_event('offer_updated', 'offer', v_id, jsonb_build_object('title', v_title));
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_set_promotion_active(p_kind text, p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('promotions.manage') then
    raise exception 'not authorized';
  end if;
  if p_kind = 'banner' then
    update banners set is_active = coalesce(p_active, is_active) where id = p_id;
  elsif p_kind = 'offer' then
    update offers set is_active = coalesce(p_active, is_active) where id = p_id;
  else
    raise exception 'unknown kind';
  end if;
  if not found then raise exception '% not found', p_kind; end if;
  perform log_audit_event(p_kind || '_' || case when p_active then 'shown' else 'hidden' end, p_kind, p_id, '{}'::jsonb);
end;
$$;

create or replace function public.admin_delete_promotion(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if not has_permission('promotions.manage') then
    raise exception 'not authorized';
  end if;
  if p_kind = 'banner' then
    delete from banners where id = p_id returning title into v_title;
  elsif p_kind = 'offer' then
    delete from offers where id = p_id returning title into v_title;
  else
    raise exception 'unknown kind';
  end if;
  if v_title is null then raise exception '% not found', p_kind; end if;
  perform log_audit_event(p_kind || '_deleted', p_kind, p_id, jsonb_build_object('title', v_title));
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Delivery zones: what customers pay
-- ---------------------------------------------------------------------------------------------------------------------------------------
-- NULL = leave as it is. Free delivery is switched OFF with p_no_free_delivery (a NULL threshold cannot mean both "unchanged" and "none").
create or replace function public.admin_update_zone(
  p_zone_id uuid,
  p_name text default null,
  p_delivery_fee numeric default null,
  p_minimum_order_value numeric default null,
  p_free_delivery_threshold numeric default null,
  p_no_free_delivery boolean default false,
  p_estimated_minutes integer default null,
  p_is_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zone delivery_zones%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_min numeric;
  v_free numeric;
  v_changes jsonb := '{}'::jsonb;
begin
  if not has_permission('zones.manage') then
    raise exception 'not authorized';
  end if;
  select * into v_zone from delivery_zones where id = p_zone_id for update;
  if not found then raise exception 'zone not found'; end if;

  if p_name is not null and (v_name is null or char_length(v_name) not between 2 and 80) then raise exception 'the name must be 2 to 80 characters'; end if;
  if p_delivery_fee is not null and p_delivery_fee not between 0 and 500 then raise exception 'the delivery fee must be between 0 and 500'; end if;
  if p_minimum_order_value is not null and p_minimum_order_value not between 0 and 5000 then raise exception 'the minimum order must be between 0 and 5000'; end if;
  if p_free_delivery_threshold is not null and p_free_delivery_threshold not between 1 and 100000 then raise exception 'free delivery must start at an amount between 1 and 100000'; end if;
  if p_estimated_minutes is not null and p_estimated_minutes not between 5 and 240 then raise exception 'the delivery time must be between 5 and 240 minutes'; end if;
  if p_no_free_delivery and p_free_delivery_threshold is not null then raise exception 'choose either "no free delivery" or an amount, not both'; end if;

  v_min := coalesce(p_minimum_order_value, v_zone.minimum_order_value);
  v_free := case when p_no_free_delivery then null when p_free_delivery_threshold is not null then p_free_delivery_threshold else v_zone.free_delivery_threshold end;
  -- Free delivery below the minimum order could never apply: resolve_checkout() only gives it to carts that already meet the minimum.
  if v_free is not null and v_free < v_min then raise exception 'free delivery must start at or above the minimum order (%)', v_min; end if;

  if v_name is not null and v_name is distinct from v_zone.name then v_changes := v_changes || jsonb_build_object('name', v_name); end if;
  if p_delivery_fee is not null and p_delivery_fee is distinct from v_zone.delivery_fee then v_changes := v_changes || jsonb_build_object('deliveryFee', p_delivery_fee, 'was', v_zone.delivery_fee); end if;
  if v_min is distinct from v_zone.minimum_order_value then v_changes := v_changes || jsonb_build_object('minimumOrderValue', v_min); end if;
  if v_free is distinct from v_zone.free_delivery_threshold then v_changes := v_changes || jsonb_build_object('freeDeliveryThreshold', v_free); end if;
  if p_estimated_minutes is not null and p_estimated_minutes is distinct from v_zone.estimated_delivery_minutes then v_changes := v_changes || jsonb_build_object('estimatedMinutes', p_estimated_minutes); end if;
  if p_is_active is not null and p_is_active is distinct from v_zone.is_active then v_changes := v_changes || jsonb_build_object('isActive', p_is_active); end if;

  if v_changes = '{}'::jsonb then return; end if;

  update delivery_zones set
    name = coalesce(v_name, name),
    delivery_fee = coalesce(p_delivery_fee, delivery_fee),
    minimum_order_value = v_min,
    free_delivery_threshold = v_free,
    estimated_delivery_minutes = coalesce(p_estimated_minutes, estimated_delivery_minutes),
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where id = p_zone_id;

  perform log_audit_event('delivery_zone_updated', 'delivery_zone', p_zone_id, v_changes);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Who may call them: signed-in users only (each function then checks the permission itself)
-- ---------------------------------------------------------------------------------------------------------------------------------------
do $grants$
declare
  f text;
begin
  foreach f in array array[
    'admin_get_promotions()',
    'admin_get_zones()',
    'admin_save_banner(uuid, text, text, text, text, text, text, banner_target_type, uuid, text, timestamptz, timestamptz, integer, boolean)',
    'admin_save_offer(uuid, text, text, text, text, text, banner_target_type, uuid, timestamptz, timestamptz, integer, boolean)',
    'admin_set_promotion_active(text, uuid, boolean)',
    'admin_delete_promotion(text, uuid)',
    'admin_update_zone(uuid, text, numeric, numeric, numeric, boolean, integer, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$grants$;
