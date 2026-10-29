-- Two findings from the tester's second report (TC-29 and TC-24).
--
-- TC-29 — "a product published with opening stock 1 does not show in the dashboard's Low Stock list".
--   The dashboard asked get_admin_inventory(low_stock_only => true, limit => 4). That function orders by inventory.id
--   (a random UUID, because it paginates by id) and low_stock_only also includes out-of-stock rows, so the four rows
--   shown were an arbitrary sample: live data showed two out-of-stock test products and two "low" rows with 99 and 400
--   units, while "Roasted Makhana" with 3 left was not shown. The COUNT on the card was right; the LIST under it was not.
--   get_admin_inventory_attention() returns the rows that need attention in the order that matters: low-stock items
--   first, fewest units left first, then out-of-stock items. "Low stock" means exactly what the Low Stock card counts
--   (available > 0, at or below the reorder level, and sold at that store); out-of-stock matches the Out of Stock card.
--
-- TC-24 — "Vijay Nagar store did not receive the purchase notification".
--   notify_on_order_created() notifies the ACTIVE staff of the order's store. Live data showed accounts called
--   "Demo Store Manager 2 (Vijay Nagar)" / "(Awas Vikas)" with NO store assigned at all, so signing in as them can never
--   produce a store notification, and if a store ever has nobody assigned, its orders produce no store notification and
--   nobody finds out. Now, when an order's store has no active staff, every active admin is told instead (an
--   admin_system_alert that opens the order), so an order can never be silently un-notified.
--
-- Rollback: drop function get_admin_inventory_attention(uuid, int); re-apply notify_on_order_created() from
-- 20260826000036.

-- ---------------------------------------------------------------------
-- TC-29: the rows that need restocking, most urgent first
-- ---------------------------------------------------------------------
create or replace function get_admin_inventory_attention(p_store_id uuid default null, p_limit int default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('inventory.view') then
    raise exception 'not authorized';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select
        i.id, i.store_id, s.name as store_name,
        pv.id as variant_id, pv.sku, pr.name as product_name, pr.image as product_image, pv.weight_value, pv.weight_unit,
        i.quantity, i.reserved_quantity, (i.quantity - i.reserved_quantity) as available_quantity,
        i.reorder_level, i.is_available,
        case when (i.quantity - i.reserved_quantity) <= 0 then 'out_of_stock'
             when (i.quantity - i.reserved_quantity) <= i.reorder_level then 'low_stock'
             else 'in_stock' end as stock_status
      from inventory i
      join product_variants pv on pv.id = i.product_variant_id
      join products pr on pr.id = pv.product_id
      join stores s on s.id = i.store_id
      where (p_store_id is null or i.store_id = p_store_id)
        and (
          -- exactly what the Low Stock card counts …
          ((i.quantity - i.reserved_quantity) > 0 and (i.quantity - i.reserved_quantity) <= i.reorder_level and i.is_available)
          -- … and what the Out of Stock card counts
          or (i.quantity - i.reserved_quantity) <= 0
        )
      order by
        case when (i.quantity - i.reserved_quantity) > 0 then 0 else 1 end,
        (i.quantity - i.reserved_quantity),
        pr.name,
        i.id
      limit least(greatest(coalesce(p_limit, 5), 1), 50)
    ) t
  );
end;
$$;

revoke all on function get_admin_inventory_attention(uuid, int) from public, anon;
grant execute on function get_admin_inventory_attention(uuid, int) to authenticated;

comment on function get_admin_inventory_attention(uuid, int) is 'The inventory rows that need restocking, most urgent first: low-stock (fewest units left first) then out-of-stock. Same definitions as the dashboard Low Stock / Out of Stock cards. Used by the dashboard Inventory Health list.';

-- ---------------------------------------------------------------------
-- TC-24: an order whose store has no active staff must still be noticed
-- ---------------------------------------------------------------------
create or replace function notify_on_order_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_admin_id uuid;
  v_store_staff_notified int := 0;
  v_store_name text;
begin
  perform create_notification(
    new.user_id, 'order_placed', 'order',
    'Order placed',
    format('We''ve received your order #%s. We''ll let you know as soon as the store confirms it.', new.order_number),
    jsonb_build_object('orderId', new.id),
    'normal', 'orders', new.id
  );

  for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
    perform create_notification(
      v_staff_id, 'store_new_order', 'order',
      'New order',
      format('Order #%s — %s. Tap to review and accept.', new.order_number, fmt_inr(new.total)),
      jsonb_build_object('orderId', new.id),
      'high', 'orders', new.id
    );
    v_store_staff_notified := v_store_staff_notified + 1;
  end loop;

  -- Nobody at that store could be told: tell the admins instead, so the order is never silently un-notified.
  if v_store_staff_notified = 0 then
    select name into v_store_name from stores where id = new.store_id;
    for v_admin_id in select admin_recipient_ids() loop
      perform create_notification(
        v_admin_id, 'admin_system_alert', 'system',
        'New order — no store staff to notify',
        format('Order #%s (%s) was placed for %s, but no active staff are assigned to that store. Open the order, or assign staff to the store.',
               new.order_number, fmt_inr(new.total), coalesce(v_store_name, 'its store')),
        jsonb_build_object('orderId', new.id),
        'high', 'orders', new.id
      );
    end loop;
  end if;

  return new;
end;
$$;

comment on function notify_on_order_created is 'Fires once per new order — customer receipt + every active staff member of the fulfilling store (section 45: that store only). If that store has no active staff, every active admin is alerted instead so the order is never silently un-notified (QA TC-24).';
