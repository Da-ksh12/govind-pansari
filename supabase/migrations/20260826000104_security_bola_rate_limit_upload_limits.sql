-- Security hardening: object-level authorization gaps, bucket-style rate
-- limiting, and server-side upload limits for the delivery-proofs bucket.

-- ---------------------------------------------------------------------
-- 1. BOLA: store_staff_recipient_ids(store) was callable by any role
--    (default PUBLIC execute) and returned the user ids of ANY store's
--    active staff. It is only an internal helper for notification
--    triggers (all SECURITY DEFINER), so nobody needs direct access.
-- ---------------------------------------------------------------------
revoke all on function store_staff_recipient_ids(uuid) from public, anon, authenticated;
-- ---------------------------------------------------------------------
-- 2. BOLA: complete_delivery accepted ANY string as the proof photo, so a
--    rider could attach another delivery's (private) proof photo or an
--    arbitrary URL to their own delivery. Proof photos are uploaded under
--    `${assignmentId}/...` (storage RLS keys on that folder); require the
--    same prefix here. The existing function becomes the internal impl.
-- ---------------------------------------------------------------------
alter function complete_delivery(uuid, text, double precision, double precision, numeric)
  rename to complete_delivery_impl;
revoke all on function complete_delivery_impl(uuid, text, double precision, double precision, numeric)
  from public, anon, authenticated;
create or replace function complete_delivery(
  p_assignment_id uuid,
  p_proof_photo_url text,
  p_proof_latitude double precision,
  p_proof_longitude double precision,
  p_cash_collected numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_proof_photo_url is not null and btrim(p_proof_photo_url) <> ''
     and p_proof_photo_url not like p_assignment_id::text || '/%' then
    raise exception 'delivery proof photo does not belong to this delivery';
  end if;
  perform complete_delivery_impl(p_assignment_id, p_proof_photo_url, p_proof_latitude, p_proof_longitude, p_cash_collected);
end;
$$;
revoke all on function complete_delivery(uuid, text, double precision, double precision, numeric) from public, anon;
grant execute on function complete_delivery(uuid, text, double precision, double precision, numeric) to authenticated;
-- ---------------------------------------------------------------------
-- 3. Token-bucket rate limiting. One row per (action, user): `tokens`
--    refills continuously at refill_per_sec up to capacity; each call
--    spends one. The single-statement upsert takes the row lock, so
--    concurrent calls cannot overspend.
-- ---------------------------------------------------------------------
create table rate_limit_buckets (
  key text primary key,
  tokens double precision not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table rate_limit_buckets enable row level security;
-- no policies: only SECURITY DEFINER code touches it

create or replace function take_rate_limit_token(p_key text, p_capacity int, p_refill_per_sec double precision)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens double precision;
begin
  -- ponytail: opportunistic cleanup of idle buckets; swap for pg_cron if the table grows large
  if random() < 0.01 then
    delete from rate_limit_buckets where updated_at < now() - interval '1 day';
  end if;

  insert into rate_limit_buckets as b (key, tokens, updated_at)
  values (p_key, p_capacity - 1, clock_timestamp())
  on conflict (key) do update
    set tokens = least(p_capacity, b.tokens + extract(epoch from clock_timestamp() - b.updated_at) * p_refill_per_sec) - 1,
        updated_at = clock_timestamp()
    where least(p_capacity, b.tokens + extract(epoch from clock_timestamp() - b.updated_at) * p_refill_per_sec) >= 1
  returning tokens into v_tokens;

  return v_tokens is not null;
end;
$$;
revoke all on function take_rate_limit_token(text, int, double precision) from public, anon, authenticated;
-- Per-action limits live here so a client can't pick its own capacity.
create or replace function enforce_rate_limit(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_refill double precision;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  case p_action
    when 'checkout'       then v_capacity := 20; v_refill := 1.0 / 3;   -- burst 20, then 1 per 3s
    when 'review'         then v_capacity := 10; v_refill := 1.0 / 30;
    when 'razorpay_order' then v_capacity := 10; v_refill := 1.0 / 6;
    when 'staff_invite'   then v_capacity := 10; v_refill := 1.0 / 60;
    else raise exception 'unknown rate limit action';
  end case;
  if not take_rate_limit_token(p_action || ':' || auth.uid()::text, v_capacity, v_refill) then
    raise exception 'rate_limit_exceeded: too many requests, please wait a moment' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function enforce_rate_limit(text) from public, anon;
grant execute on function enforce_rate_limit(text) to authenticated;
-- Wrap checkout + review by renaming the originals to *_impl (internal only).
alter function create_order_from_cart(uuid, text, payment_method) rename to create_order_from_cart_impl;
revoke all on function create_order_from_cart_impl(uuid, text, payment_method) from public, anon, authenticated;
create or replace function create_order_from_cart(p_address_id uuid, p_idempotency_key text, p_payment_method payment_method default 'cod')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform enforce_rate_limit('checkout');
  return create_order_from_cart_impl(p_address_id, p_idempotency_key, p_payment_method);
end;
$$;
revoke all on function create_order_from_cart(uuid, text, payment_method) from public, anon;
grant execute on function create_order_from_cart(uuid, text, payment_method) to authenticated;
alter function add_review(uuid, smallint, text, text[]) rename to add_review_impl;
revoke all on function add_review_impl(uuid, smallint, text, text[]) from public, anon, authenticated;
create or replace function add_review(p_product_id uuid, p_rating smallint, p_comment text default null, p_images text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  perform enforce_rate_limit('review');
  return add_review_impl(p_product_id, p_rating, p_comment, p_images);
end;
$$;
revoke all on function add_review(uuid, smallint, text, text[]) from public, anon;
grant execute on function add_review(uuid, smallint, text, text[]) to authenticated;
-- ---------------------------------------------------------------------
-- 4. Upload validation, server side: delivery-proofs had no size/type
--    limit at all (product-images and avatars already do).
-- ---------------------------------------------------------------------
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'delivery-proofs';
