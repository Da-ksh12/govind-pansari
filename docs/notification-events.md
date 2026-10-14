# Event → Notification Mapping (Phase 10)

Section 37 asked for a matrix and explicitly said not to follow its
own example blindly, but to review it against real business rules.
This app's actual state machine (Phases 05/07/08) makes several of the
spec's business-event names ambiguous against its own vocabulary —
notably "ORDER_CONFIRMED" as a *business event* (spec section 13
implies it means "order successfully placed") versus `orders.status =
'confirmed'` (this app's real meaning: the store accepted it). The
mapping below resolves every one of those ambiguities against the real
schema, not the spec's prose.

## Source-of-truth ownership (why nothing double-fires)

Three event streams exist and several of them fire in the *same
transaction* for the same real-world moment (e.g. `assign_rider()`
inserts both an `order_events` row and a `delivery_events` row). Each
notification has exactly **one** authoritative source:

| Order stage | Authoritative source | Why not the others |
|---|---|---|
| `placed` (new order) | `orders` `AFTER INSERT` (new) | no existing stream captured creation at all |
| `confirmed` / `preparing` / `packed` / `cancelled` | `order_status_history` (`new_status`) | exhaustive and automatic; `order_events`' `order_accepted`/`order_rejected` fire in the same transaction but aren't needed once status is used directly |
| `picking` / `packing` | *(nothing)* | internal store-ops sub-phases, not customer-meaningful (section 13: "do not spam") |
| rider assigned → delivered | `delivery_events` | has rider_id/delivery_id the other two streams don't; `order_events`' matching rows (`rider_assigned`, `order_picked_up`, etc.) are redundant once this fires |
| arriving soon | client-triggered `notify_arriving_soon()` | no server-side ETA computation exists (Phase 09 routing is client-side) — see below |

`order_events` itself ends up **not** wired to any notification
trigger. Every customer/store-meaningful moment it captures is
superseded by one of the two rows above; its remaining entries
(`item_picked`, `item_unavailable`, `exception_resolved`) are
deliberately internal.

## Full mapping

| Event type | Source | Customer | Rider | Store | Admin |
|---|---|:-:|:-:|:-:|:-:|
| Order placed | `orders` INSERT | `order_placed` | — | `store_new_order` | — |
| Confirmed (store accepted) | `order_status_history` | `order_confirmed` | — | — | — |
| Preparing started | `order_status_history` | `order_preparing` | — | — | — |
| Packed | `order_status_history` | `order_packed` | — | — | — |
| Cancelled (either path) | `order_status_history` | `order_cancelled` | — | `order_cancelled` | — |
| Rider assigned | `delivery_events` | `rider_assigned` | `delivery_assigned` (high priority) | `rider_assigned` | — |
| Rider at store | `delivery_events` | `rider_at_store` | — | `rider_at_store` | — |
| Picked up | `delivery_events` | `order_picked_up` | — | `order_picked_up` | — |
| Delivery started | `delivery_events` | `order_out_for_delivery` | — | — | — |
| Arriving soon | client RPC | `delivery_arriving` | — | — | — |
| Delivered | `delivery_events` | `order_delivered` | — | `order_delivered` (low priority) | — |
| Delivery failed | `delivery_events` | `delivery_failed` (high) | `delivery_exception` | `delivery_failed` | `admin_failed_delivery` (urgent) |
| Reassigned (expired/cancelled) | `delivery_events` | — | `delivery_reassigned` (to the *previous* rider — the new rider's own `delivery_assigned` fires independently when reassignment actually happens) | — | — |
| Rider not responding | `scan_notification_alerts()` (cron, every 5 min) | — | `delivery_reminder` (high) | — | — |
| Delivery unassigned > 10 min | `scan_notification_alerts()` | — | — | — | `admin_unassigned_delivery` (urgent) |
| Order unconfirmed > 15 min | `scan_notification_alerts()` | — | — | — | `admin_system_alert` (high) |

## Deliberately not built as separate types

- **Rider `CUSTOMER_UNAVAILABLE`** — the spec lists this, but there's
  no event in this app distinct from the rider's own `fail_delivery()`
  call (which they initiate). Folded into `delivery_exception`.
- **Rider `DELIVERY_CANCELLED`** — `cancel_assignment()` (manager
  reassigning) is the only path that removes a delivery from a rider
  mid-flight, and it's exactly what "reassigned" already describes.
  Building a second, functionally-identical type would just be two
  names for the same real event.
- **`ORDER_CREATED`/`ORDER_CONFIRMED` as separate spec-literal types**
  — resolved into `order_placed` (checkout success) and
  `order_confirmed` (store acceptance) respectively, matching this
  app's real status vocabulary rather than the spec's looser prose.

## `DELIVERY_ARRIVING` — the one client-originated event

Every other row above is a pure database trigger. This one isn't,
because the *signal* it reacts to — ETA crossing the "arriving soon"
threshold — is computed client-side by Phase 09's `useLiveRoute`/
`formatEta` (OSRM is called from the device, there's no server-side
routing engine to react to). `app/track/[orderId].tsx` calls
`notify_arriving_soon(order_id)` once when it first observes this;
the function re-derives the order and its active `in_transit`
assignment server-side and dedupes on the assignment's own id, so a
client bug that calls it repeatedly still produces exactly one
notification (section 47). This is documented as a deliberate,
narrow exception to "event-driven, not scattered in the UI" — the
*decision, dedup, and send* still go through the same
`create_notification()` path as everything else; only the trigger
condition originates in the UI layer, because that's genuinely where
the only copy of that data lives.
