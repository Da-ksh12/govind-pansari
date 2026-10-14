-- CRITICAL fix: verify-razorpay-payment recomputed Razorpay's HMAC
-- signature correctly, but never checked that the razorpay_order_id
-- the client supplied was actually the one created FOR THIS internal
-- order. A genuine, correctly-signed (razorpay_order_id, payment_id,
-- signature) triple from paying for order B could be replayed against
-- ANY other pending order the same customer owns, marking it paid for
-- free — the signature alone proves the payment is real, not which
-- order it was for. Found via live security audit before any real
-- exploitation.
--
-- Fix: persist the razorpay_order_id created for each internal order
-- (set_payment_gateway_order, called by create-razorpay-order right
-- after creating it), and have the client-supplied razorpay_order_id
-- checked against that stored value BEFORE any signature math runs
-- (get_order_for_payment now returns it for the Edge Function to compare).

alter table payments add column if not exists gateway_order_id text;

create or replace function set_payment_gateway_order(p_order_id uuid, p_gateway_order_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from orders where id = p_order_id and user_id = auth.uid()) then
    raise exception 'order not found, or not yours';
  end if;
  update payments set gateway_order_id = p_gateway_order_id where order_id = p_order_id;
end;
$$;

comment on function set_payment_gateway_order is 'Binds a freshly-created Razorpay order to the internal order it was created for — the other half of the fix that stops one real payment being replayed against a different order (see verify-razorpay-payment). Ownership-checked: only the order''s own customer can set this, matching every other payment RPC''s boundary.';

revoke all on function set_payment_gateway_order from public, anon;
grant execute on function set_payment_gateway_order to authenticated;

-- get_order_for_payment now also returns the stored gateway_order_id
-- so verify-razorpay-payment can reject a mismatch before ever
-- computing a signature.
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
    'gatewayOrderId', p.gateway_order_id
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

revoke all on function get_order_for_payment from public, anon;
grant execute on function get_order_for_payment to authenticated;
