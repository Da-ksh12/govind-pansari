# Order Events (Phase 07)

## Why a new table, given `order_status_history` already exists

`order_status_history` (Phase 01) is auto-populated by the
`orders_log_status_change` trigger — it fires on *any* `orders.status`
`UPDATE`, whoever performs it, and is specifically shaped for that:
`old_status`, `new_status`, `changed_by`, `changed_at`. It's exactly
right for "what did this order's status do over time," and Phase 07
doesn't touch it.

`order_events` is broader and serves a different purpose (section
40/41): a general operational event stream that also captures things
that **aren't** a status transition at all — `item_picked` and
`item_unavailable` are per-item events with no corresponding
`orders.status` change; `order_rejected` carries a reason in its
metadata that `order_status_history`'s fixed columns have no room for.
Building this as a second, purpose-built table isn't duplicate
architecture — it's the brief's own explicit ask ("Create a clean
order-event architecture... These events will later drive:
notifications, analytics, rider dispatch, customer tracking").

## Shape

```sql
order_events (
  id, order_id, store_id, actor_id, event_type, metadata jsonb, created_at
)
```

`event_type` is a real Postgres enum (`order_event_type`), matching
this project's existing convention for controlled vocabularies
(`order_status`, `payment_status`, ...) rather than a free-text column
— consistency with the established pattern won out over the slightly
lower ceremony of extending a text+check list later.

## Events written this phase

| `event_type` | Written by | When |
|---|---|---|
| `order_accepted` | `accept_order()` | `placed → confirmed` |
| `order_rejected` | `reject_order()` | `placed → cancelled`, reason + notes in `metadata` |
| `processing_started` | `advance_order_fulfillment()` | `confirmed → preparing` |
| `picking_started` | `advance_order_fulfillment()` | `preparing → picking` |
| `item_picked` | `mark_order_item_picked()` | per item, `picking_status = 'picked'` |
| `item_unavailable` | `mark_order_item_picked()` | per item, `picking_status = 'unavailable'` |
| `packing_started` | `advance_order_fulfillment()` | `picking → packing` |
| `order_packed` | `advance_order_fulfillment()` | `packing → packed` (logged alongside `order_ready_for_pickup` — see below) |
| `order_ready_for_pickup` | `advance_order_fulfillment()` | `packing → packed` |
| `exception_resolved` | `resolve_order_exception()` | manager clears `has_exception` |

`order_packed` and `order_ready_for_pickup` are logged **together**,
from the same `packing → packed` transition — the brief's event
vocabulary (section 40) names them as two distinct moments, but this
phase's status machine treats `packed` as the terminal state
(READY_FOR_PICKUP — see `docs/order-fulfillment.md`), so there's no
real gap in time between them to log separately. Logging both events
preserves fidelity to the named vocabulary for whatever a later phase
builds on top of `order_events` (notifications, analytics) without
requiring a status value that doesn't otherwise exist.

## RLS

```sql
create policy "order_events_store_read" on order_events for select
  using (is_store_staff(store_id) or is_admin() or exists (
    select 1 from orders where orders.id = order_events.order_id and orders.user_id = auth.uid()
  ));
```

Store staff of the relevant store, admins, and — deliberately — the
order's own customer can all read it. No customer-facing screen
surfaces this yet (section 39: "do not redesign the customer app"),
but the RLS is already correct for whenever one does (e.g. a future
"your order is being packed" live-updating status), rather than
needing a policy change alongside that future feature.

No client insert/update/delete policy — every row is written by one
of the `SECURITY DEFINER` functions above, matching this project's
consistent pattern for anything requiring server-side validation
(cart mutations in Phase 04, order creation in Phase 05, and now the
fulfillment functions in this phase).

## What consumes this later (not built yet)

Notifications (push/WhatsApp/SMS on `order_accepted`/`order_rejected`/
`item_unavailable`/etc.), store performance analytics beyond what
`get_store_dashboard()` already aggregates from `orders`' own
timestamp columns, and rider dispatch triggers on
`order_ready_for_pickup`. All explicitly out of scope for Phase 07
(section 17, section 59) — this table exists now specifically so those
future phases have real data to consume rather than needing their own
retrofitted event log.
