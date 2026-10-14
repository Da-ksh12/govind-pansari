-- Follow-up to 20260826000095: qa_make_rider_busy() leaves a fresh
-- assignment in the normal pending-accept window (assigned, not yet
-- accepted) — which is CORRECT, real behaviour (assign_rider() always
-- starts there), but it means an untouched "Make Busy" demo rider
-- silently reverts to available after the same 5-minute
-- assignment_expiry_minutes() window a real unaccepted manual
-- assignment would. Found live while re-verifying the seeded demo
-- rider states after the regression suites ran (Demo Rider 04's
-- assignment had auto-expired in the background). Fixed by letting
-- qa_make_rider_busy() also accept it immediately, via the same
-- has_permission('settings.manage') carve-out already added to
-- accept_delivery_offer() in 20260826000095, so a QA demo rider stays
-- genuinely busy until qa_clear_rider_busy() explicitly undoes it.

create or replace function accept_delivery(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment delivery_assignments%rowtype;
begin
  select * into v_assignment from delivery_assignments where id = p_assignment_id for update;
  if v_assignment is null then raise exception 'delivery assignment not found'; end if;
  if not (
    exists (select 1 from riders where id = v_assignment.rider_id and profile_id = auth.uid())
    or has_permission('settings.manage')
  ) then
    raise exception 'not authorized for this delivery';
  end if;
  if v_assignment.status = 'expired' then
    raise exception 'this assignment has expired';
  end if;
  if v_assignment.status <> 'assigned' then
    raise exception 'delivery is not awaiting acceptance (current: %)', v_assignment.status;
  end if;

  update delivery_assignments set status = 'accepted', accepted_at = now() where id = p_assignment_id;
  insert into delivery_events (delivery_id, order_id, rider_id, store_id, event_type)
    values (p_assignment_id, v_assignment.order_id, v_assignment.rider_id, v_assignment.store_id, 'delivery_accepted');
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (v_assignment.order_id, v_assignment.store_id, auth.uid(), 'rider_accepted');
end;
$$;

revoke all on function accept_delivery from public, anon;
grant execute on function accept_delivery to authenticated;

create or replace function qa_make_rider_busy(p_rider_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rider riders%rowtype;
  v_order jsonb;
  v_order_id uuid;
  v_assignment_id uuid;
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;
  select * into v_rider from riders where id = p_rider_id;
  if v_rider is null then
    raise exception 'rider not found';
  end if;
  if exists (select 1 from delivery_assignments where rider_id = p_rider_id and not is_terminal_delivery_status(status)) then
    raise exception 'this rider already has an active delivery';
  end if;
  if not v_rider.is_active or not v_rider.is_available then
    raise exception 'rider must be active and available before being given a delivery';
  end if;

  v_order := qa_create_demo_order(p_customer_id, v_rider.primary_store_id);
  if not (v_order->>'success')::boolean then
    return v_order;
  end if;
  v_order_id := (v_order->>'orderId')::uuid;

  v_assignment_id := assign_rider(v_order_id, p_rider_id, 'manual');
  perform accept_delivery(v_assignment_id);

  return jsonb_build_object('success', true, 'orderId', v_order_id, 'assignmentId', v_assignment_id);
end;
$$;

comment on function qa_make_rider_busy is 'QA/demo only — creates a real demo order at the rider''s own store, assigns it to them, and immediately accepts it on their behalf (accept_delivery()''s settings.manage carve-out) so the rider stays genuinely BUSY indefinitely rather than reverting to available when the normal pending-accept window elapses. Undo with qa_clear_rider_busy().';

revoke all on function qa_make_rider_busy(uuid, uuid) from public, anon;
grant execute on function qa_make_rider_busy(uuid, uuid) to authenticated;
