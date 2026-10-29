-- QA report TC-22 / payment-security audit: payment confirmation must be
-- idempotent and safe against duplicate, delayed and out-of-order callbacks.
--
-- Problems in confirm_payment() as it stood (20260826000062):
--   * Not idempotent. Two 'paid' confirmations — the app's
--     verify-razorpay-payment call and a gateway webhook racing it, or a
--     webhook retried by Razorpay — each ran the inventory conversion, so the
--     order's stock was deducted twice.
--   * A late 'failed' (an earlier attempt's failure arriving after a retry
--     succeeded) overwrote a paid order with payment_status 'failed' and
--     cancelled it.
--   * A 'paid' for an order the 15-minute expiry sweep had already cancelled
--     re-ran the stock conversion against reservations that were already
--     released.
--
-- Rules now:
--   * An order that is already paid is never changed by a paid/failed
--     callback (refund states are still allowed through).
--   * A 'paid' for an already-cancelled order records the real payment state
--     (payments.status / orders.payment_status = 'paid', flagged in
--     provider_response) but leaves the order cancelled and touches no stock:
--     the money was taken, so it needs a refund — there is no refund
--     automation in this system, so such rows must be reconciled manually
--     (select ... from payments p join orders o on o.id = p.order_id
--      where p.status = 'paid' and o.status = 'cancelled').
--   * A 'failed' for an already-cancelled order only records the failure.
--
-- confirm_payment_from_webhook(): the entry point for the Razorpay webhook
-- Edge Function (supabase/functions/razorpay-webhook). It finds the order from
-- the gateway order id that create-razorpay-order bound to it, refuses a
-- payment whose amount or currency does not match the order total, and then
-- delegates to confirm_payment(). Service role only.
--
-- Rollback: re-apply confirm_payment() from 20260826000062;
--           drop function confirm_payment_from_webhook(text, text, bigint, text, jsonb).

create or replace function confirm_payment(
  p_order_id uuid, p_status payment_status, p_provider text default null,
  p_payment_reference text default null, p_provider_response jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item record;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;

  -- Already paid: a repeated 'paid' is a no-op and a late 'failed'/'pending'
  -- must never downgrade it. Only refund transitions may move a paid order.
  if v_order.payment_status = 'paid' and p_status not in ('refunded', 'partially_refunded') then
    return;
  end if;

  -- The order was cancelled (for example by the unpaid-order expiry) before
  -- this callback arrived. Record the real payment state, but do not revive
  -- the order and do not touch stock — its reservation was already released.
  if v_order.status = 'cancelled' and p_status in ('paid', 'failed') then
    update payments
      set status = p_status,
          provider = coalesce(p_provider, provider),
          payment_reference = coalesce(p_payment_reference, payment_reference),
          provider_response = coalesce(p_provider_response, '{}'::jsonb)
            || case when p_status = 'paid' then jsonb_build_object('late_payment_on_cancelled_order', true) else '{}'::jsonb end
      where order_id = p_order_id;
    update orders set payment_status = p_status where id = p_order_id;
    return;
  end if;

  update payments
    set status = p_status,
        provider = coalesce(p_provider, provider),
        payment_reference = coalesce(p_payment_reference, payment_reference),
        provider_response = coalesce(p_provider_response, provider_response)
    where order_id = p_order_id;

  if p_status = 'paid' then
    for v_item in select * from order_items where order_id = p_order_id loop
      update inventory
        set quantity = quantity - v_item.quantity,
            reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
      values (v_order.store_id, v_item.product_variant_id, -v_item.quantity, 'sale', 'order', p_order_id, null);
    end loop;

    update orders set payment_status = 'paid', status = case when status = 'placed' then 'confirmed' else status end
      where id = p_order_id;

  elsif p_status = 'failed' then
    for v_item in select * from order_items where order_id = p_order_id loop
      update inventory
        set reserved_quantity = greatest(reserved_quantity - v_item.quantity, 0)
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;

      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
      values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'reservation_release', 'order', p_order_id, null);
    end loop;

    update orders set payment_status = 'failed', status = 'cancelled' where id = p_order_id;
  else
    update orders set payment_status = p_status where id = p_order_id;
  end if;
end;
$$;

revoke all on function confirm_payment from public, anon, authenticated;

create or replace function confirm_payment_from_webhook(
  p_gateway_order_id text,
  p_payment_reference text,
  p_amount_paise bigint,
  p_currency text,
  p_provider_response jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments%rowtype;
  v_order orders%rowtype;
begin
  if coalesce(p_gateway_order_id, '') = '' then
    return jsonb_build_object('outcome', 'unknown_order');
  end if;

  select * into v_payment from payments where gateway_order_id = p_gateway_order_id order by created_at desc limit 1;
  if v_payment.id is null then
    return jsonb_build_object('outcome', 'unknown_order');
  end if;

  select * into v_order from orders where id = v_payment.order_id;
  if v_order.id is null then
    return jsonb_build_object('outcome', 'unknown_order');
  end if;

  -- The amount and currency must be exactly what this order costs; a payment
  -- for any other amount is never accepted as payment for the order.
  if upper(coalesce(p_currency, '')) <> 'INR' or p_amount_paise is null or p_amount_paise <> round(v_order.total * 100)::bigint then
    return jsonb_build_object('outcome', 'amount_mismatch', 'orderId', v_order.id);
  end if;

  if v_order.payment_status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid', 'orderId', v_order.id);
  end if;

  perform confirm_payment(
    v_order.id, 'paid', 'razorpay', p_payment_reference,
    coalesce(p_provider_response, '{}'::jsonb) || jsonb_build_object('source', 'webhook')
  );

  return jsonb_build_object(
    'outcome', case when v_order.status = 'cancelled' then 'late_payment_on_cancelled_order' else 'confirmed' end,
    'orderId', v_order.id
  );
end;
$$;

comment on function confirm_payment_from_webhook is 'Razorpay webhook entry point (service role only): maps the gateway order id to the internal order, checks amount and currency, then confirms via the idempotent confirm_payment().';

revoke all on function confirm_payment_from_webhook from public, anon, authenticated;
