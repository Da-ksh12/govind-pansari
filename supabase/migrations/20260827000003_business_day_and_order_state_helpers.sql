-- Shared definitions so every dashboard, list and fulfillment guard
-- answers the same questions the same way (QA report TC-05/07/14/15/22).
--
--   * business_day_start(): "today" for this business is an Indian
--     calendar day. The dashboard used date_trunc('day', now()) which
--     runs in the database's UTC clock, so "today" began at 05:30 IST and
--     any order placed between midnight and 05:30 IST was reported under
--     "yesterday".
--   * is_active_order_status(): the ONE definition of an active order —
--     every status that is not terminal (delivered / cancelled).
--   * order_awaits_online_payment(): an order whose latest payment attempt
--     is a prepaid method (UPI / card / net banking / wallet) and that has
--     not been verified as paid. create_order_from_cart() creates the
--     order and reserves stock BEFORE the gateway opens, so until
--     verify-razorpay-payment confirms the payment such an order is a
--     pending-payment record, not an order the store may act on and not
--     revenue. COD orders (payment settles at the door) are never
--     "awaiting online payment".
--
-- Rollback: drop function business_day_start(int);
--           drop function is_active_order_status(order_status);
--           drop function order_awaits_online_payment(uuid);
-- (nothing else depends on them until migrations 104/105 are applied).

create or replace function business_day_start(p_offset_days int default 0)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (date_trunc('day', now() at time zone 'Asia/Kolkata') + make_interval(days => p_offset_days)) at time zone 'Asia/Kolkata';
$$;

comment on function business_day_start is 'Start (00:00 Asia/Kolkata) of the business day p_offset_days from today, as timestamptz. 0 = today, -1 = yesterday.';

create or replace function is_active_order_status(p_status order_status)
returns boolean
language sql
immutable
as $$
  select p_status not in ('delivered', 'cancelled');
$$;

comment on function is_active_order_status is 'The single definition of an active order: any status that is not terminal (delivered, cancelled).';

create or replace function order_awaits_online_payment(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from orders o
    where o.id = p_order_id
      and o.payment_status <> 'paid'
      and exists (select 1 from payments p where p.order_id = o.id)
      and (
        select p.method from payments p where p.order_id = o.id order by p.created_at desc limit 1
      ) <> 'cod'
  );
$$;

comment on function order_awaits_online_payment is 'True while the order''s latest payment attempt is a prepaid method that has not been verified paid. Such an order must not be accepted, packed, dispatched or counted as revenue. Orders with no payments row (legacy) and COD orders return false.';

revoke all on function business_day_start from public, anon;
revoke all on function is_active_order_status from public, anon;
-- Internal only: it answers "is this order unpaid?" for any order id, so clients must not call
-- it directly (same object-level-authorization stance as 20260826000104). Every function that
-- uses it is SECURITY DEFINER and runs with the owner's rights.
revoke all on function order_awaits_online_payment from public, anon, authenticated;
grant execute on function business_day_start to authenticated;
grant execute on function is_active_order_status to authenticated;
