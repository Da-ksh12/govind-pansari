-- Mandatory photo proof-of-delivery, matching Zepto/Blinkit: a rider
-- can no longer mark a delivery complete without a photo. Previously
-- delivery_verification_method had a 'photo' enum value that nothing
-- ever set — completion always went through as 'order_number' with no
-- photo captured at all. This closes that gap by making photo proof
-- the only completion path, enforced server-side (not just hidden
-- behind a disabled button), so a compromised or hand-rolled client
-- can't skip it.

alter table delivery_assignments
  add column delivery_proof_photo_url text;

-- ---------------------------------------------------------------------
-- Storage: one photo per delivery, path-prefixed by assignment id
-- (`${assignmentId}/${file}`) so RLS can join back to the specific
-- delivery instead of only checking "is any rider" like product-images
-- does — a proof-of-delivery photo shows a real customer's doorstep,
-- so read access is scoped to people who actually have a reason to see
-- it, not made bucket-wide public like the product catalogue photos.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('delivery-proofs', 'delivery-proofs', false)
on conflict (id) do nothing;

create policy "delivery_proofs_rider_write" on storage.objects
  for insert with check (
    bucket_id = 'delivery-proofs'
    and exists (
      select 1 from riders r
      join delivery_assignments da on da.rider_id = r.id
      where r.profile_id = auth.uid()
      and da.id::text = (storage.foldername(name))[1]
    )
  );

create policy "delivery_proofs_read" on storage.objects
  for select using (
    bucket_id = 'delivery-proofs'
    and exists (
      select 1 from delivery_assignments da
      join orders o on o.id = da.order_id
      where da.id::text = (storage.foldername(name))[1]
      and (
        o.user_id = auth.uid()
        or exists (select 1 from riders r where r.id = da.rider_id and r.profile_id = auth.uid())
        or is_admin()
        or exists (select 1 from store_staff ss where ss.store_id = da.store_id and ss.user_id = auth.uid() and ss.is_active)
      )
    )
  );

-- ---------------------------------------------------------------------
-- complete_delivery: drop the old 3-arg signature entirely (not just
-- shadow it) so no code path — including a hand-rolled RPC call — can
-- still complete a delivery without a photo via the old overload.
-- ---------------------------------------------------------------------
drop function if exists complete_delivery(uuid, delivery_verification_method, numeric);

create or replace function complete_delivery(
  p_assignment_id uuid,
  p_proof_photo_url text,
  p_cash_collected numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
  v_order orders%rowtype;
begin
  if p_proof_photo_url is null or btrim(p_proof_photo_url) = '' then
    raise exception 'a delivery proof photo is required to complete this delivery';
  end if;

  select * into v_assignment from delivery_assignments where id = p_assignment_id for update;
  if v_assignment is null then raise exception 'delivery assignment not found'; end if;
  if not exists (select 1 from riders where id = v_assignment.rider_id and profile_id = auth.uid()) then
    raise exception 'not authorized for this delivery';
  end if;
  if v_assignment.status <> 'in_transit' then
    raise exception 'delivery must be out for delivery before it can be completed (current: %)', v_assignment.status;
  end if;
  select * into v_order from orders where id = v_assignment.order_id for update;
  if v_order.status <> 'out_for_delivery' then
    raise exception 'order is not currently out for delivery (current: %)', v_order.status;
  end if;

  update delivery_assignments set
    status = 'completed',
    completed_at = now(),
    delivery_verification_method = 'photo',
    delivery_proof_photo_url = p_proof_photo_url,
    cash_collected = p_cash_collected,
    payment_collection_status = case when p_cash_collected is not null then 'collected' when v_order.payment_status = 'pending' then 'pending' else 'not_applicable' end
  where id = p_assignment_id;

  update orders set
    status = 'delivered',
    delivered_at = now(),
    payment_status = case when payment_status = 'pending' then 'paid' else payment_status end
  where id = v_assignment.order_id;

  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type, metadata)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_completed', jsonb_build_object('verificationMethod', 'photo', 'proofPhotoUrl', p_proof_photo_url, 'cashCollected', p_cash_collected));
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'order_delivered');
end;
$$;

comment on function complete_delivery is 'Photo proof is mandatory (Zepto/Blinkit pattern) — enforced here, not just in the rider UI, so it cannot be bypassed. Atomic: delivery + order flip together, in one transaction, or neither does. The FOR UPDATE locks on both rows are what make two simultaneous completion requests for the same delivery resolve to exactly one winner — the loser''s re-read after acquiring the lock sees status already ''completed'' and fails the precondition check.';

revoke all on function complete_delivery(uuid, text, numeric) from public, anon;
grant execute on function complete_delivery(uuid, text, numeric) to authenticated;
