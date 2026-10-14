-- Fix: notify_on_order_status_change() passed a plain CASE expression
-- for p_priority. Postgres resolves a CASE's result to a concrete
-- `text` type before matching it against create_notification()'s
-- overload, so — unlike a bare string literal, which stays untyped and
-- auto-casts fine — it failed to match the notification_priority
-- parameter at all: every call to accept_order() (or anything else
-- that flips orders.status to 'confirmed'/'preparing'/'packed'/
-- 'cancelled') started throwing "function create_notification(...)
-- does not exist", found immediately by the live test suite the first
-- time it ran. Same fix as Phase 09's composite-NULL bug in spirit —
-- caught by testing against the real deployed function, not by
-- reading the SQL text.

create or replace function notify_on_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_event notification_event_type;
  v_title text;
  v_body text;
  v_source_id uuid := md5(new.id::text || ':' || new.status::text)::uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  case new.status
    when 'confirmed' then
      v_event := 'order_confirmed';
      v_title := 'Order confirmed';
      v_body := format('Your order #%s has been confirmed and will be prepared shortly.', new.order_number);
    when 'preparing' then
      v_event := 'order_preparing';
      v_title := 'Preparing your order';
      v_body := format('The store has started preparing order #%s.', new.order_number);
    when 'packed' then
      v_event := 'order_packed';
      v_title := 'Order packed';
      v_body := format('Order #%s is packed and ready — a rider will be assigned shortly.', new.order_number);
    when 'cancelled' then
      v_event := 'order_cancelled';
      v_title := 'Order cancelled';
      v_body := case
        when new.rejection_reason is not null then format('Order #%s was cancelled by the store (%s).', new.order_number, replace(new.rejection_reason::text, '_', ' '))
        else format('Order #%s has been cancelled.', new.order_number)
      end;
    else
      return new;
  end case;

  perform create_notification(
    new.user_id, v_event, 'order', v_title, v_body,
    jsonb_build_object('orderId', new.id),
    (case when new.status = 'cancelled' then 'high' else 'normal' end)::notification_priority,
    'order_status_history', v_source_id
  );

  if new.status = 'cancelled' then
    for v_staff_id in select store_staff_recipient_ids(new.store_id) loop
      perform create_notification(
        v_staff_id, 'order_cancelled', 'order',
        'Order cancelled',
        format('Order #%s was cancelled.', new.order_number),
        jsonb_build_object('orderId', new.id),
        'normal', 'order_status_history', v_source_id
      );
    end loop;
  end if;

  return new;
end;
$$;
