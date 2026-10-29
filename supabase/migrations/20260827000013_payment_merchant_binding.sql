-- Razorpay hardening, phase 1 of 2 (phase 2 = 20260827000014, applied after the
-- new Edge Functions are deployed).
--
-- 1. Server-only gateway binding. set_payment_gateway_order() — which ties a
--    Razorpay order id to an application order — is executable by ANY signed-in
--    customer, with an id of their choosing. verify-razorpay-payment trusted that
--    binding, so a customer could pay a small order, then attach that paid Razorpay
--    order to a large unpaid one and have it accepted (the signature is valid for
--    the paid order, and the old code never compared the amount). The binding is
--    now made by bind_payment_gateway_order(), callable by the service role only
--    (create-razorpay-order, after it has checked the caller owns the order).
--    verify-razorpay-payment additionally re-checks amount, currency and the
--    Razorpay order's own notes with Razorpay's API.
--
-- 2. Merchant account tracking. payments.gateway_key_id records the (public) Razorpay
--    Key ID of the merchant account that created the gateway order. Historical rows
--    keep NULL (they predate the tracking; they belong to the merchant account that
--    was configured before the switch to the client's own account). An order started
--    under another merchant cannot be verified with the current secret, and is
--    reported as such instead of being recorded as a failed payment.
--
-- 3. A gateway order id may belong to only one payment row (it did not matter
--    before because nothing could reuse one; now the database enforces it).
--
-- Rollback: drop function bind_payment_gateway_order(uuid, text, text);
--           drop index payments_gateway_order_id_key;
--           alter table payments drop column gateway_key_id;
--           re-apply get_order_for_payment() without gatewayKeyId.

alter table payments add column if not exists gateway_key_id text;

comment on column payments.gateway_key_id is 'Public Razorpay Key ID of the merchant account that created gateway_order_id (NULL = created before merchant tracking, i.e. under the previously configured account). Not a secret.';

create unique index if not exists payments_gateway_order_id_key
  on payments (gateway_order_id)
  where gateway_order_id is not null;

create or replace function bind_payment_gateway_order(p_order_id uuid, p_gateway_order_id text, p_gateway_key_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments%rowtype;
  v_order_status order_status;
begin
  if coalesce(btrim(p_gateway_order_id), '') = '' or coalesce(btrim(p_gateway_key_id), '') = '' then
    raise exception 'gateway order id and key id are required';
  end if;

  select * into v_payment from payments where order_id = p_order_id order by created_at desc limit 1 for update;
  if v_payment.id is null then
    raise exception 'no payment for this order';
  end if;
  if v_payment.method = 'cod' then
    raise exception 'cash on delivery orders have no gateway order';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'this order''s payment is already %', v_payment.status;
  end if;
  select status into v_order_status from orders where id = p_order_id;
  if v_order_status in ('cancelled', 'delivered') then
    raise exception 'order is already %', v_order_status;
  end if;

  update payments set gateway_order_id = p_gateway_order_id, gateway_key_id = p_gateway_key_id where id = v_payment.id;
end;
$$;

comment on function bind_payment_gateway_order is 'Service role only. Records the Razorpay order id (and the merchant Key ID) that create-razorpay-order created for an application order whose payment is still pending.';

revoke all on function bind_payment_gateway_order(uuid, text, text) from public, anon, authenticated;
grant execute on function bind_payment_gateway_order(uuid, text, text) to service_role;

-- Same function as before, plus the merchant Key ID.
create or replace function get_order_for_payment(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'orderId', o.id, 'orderNumber', o.order_number, 'total', o.total,
    'paymentStatus', o.payment_status, 'paymentMethod', p.method,
    'gatewayOrderId', p.gateway_order_id, 'gatewayKeyId', p.gateway_key_id
  )
  into v_result
  from orders o
  join payments p on p.order_id = o.id
  where o.id = p_order_id and o.user_id = auth.uid();

  if v_result is null then
    raise exception 'order not found';
  end if;
  return v_result;
end;
$$;
