# Notification Architecture (Phase 10)

## The event layer already existed

The spec's own architecture diagram — BUSINESS EVENT → EVENT HANDLER →
NOTIFICATION DECISION → CHANNEL → DELIVERY → LOGGING → RETRY — describes
almost exactly what Phases 07/08 had already built, for a different
reason (audit/analytics, section 40/41 of Phase 07's own brief):

- `order_events` (Phase 07) — every store-side action (accept, reject,
  processing/picking/packing started, item picked/unavailable,
  exception resolved)
- `delivery_events` (Phase 08) — every rider/delivery-lifecycle moment
  (assigned, accepted, declined, at_store, picked_up, started,
  completed, failed, expired, cancelled)
- `order_status_history` (Phase 01) — an automatic `AFTER UPDATE`
  trigger logging every `orders.status` transition, regardless of
  which function caused it

Phase 10 is built as a pure **consumer** of these three streams via
new triggers — zero changes to any Phase 05/07/08/09 business
function. See `docs/notification-events.md` for exactly which stream
drives which notification, and why (the three streams overlap for
several real-world moments — e.g. a rider being assigned touches both
`order_events` and `delivery_events` in the same transaction — so
picking exactly one authoritative source per notification was the main
design problem, not the schema).

## Request flow

```
Business event (INSERT on order_events / delivery_events,
UPDATE on orders, or the client-triggered notify_arriving_soon)
  │
  ▼
Event trigger (notify_on_order_created / notify_on_order_status_change /
               notify_on_delivery_event) — SECURITY DEFINER, same
               transaction as the business action
  │  resolves recipient(s): customer (orders.user_id), rider
  │  (riders.profile_id), store staff (store_staff_recipient_ids),
  │  admin (admin_recipient_ids)
  ▼
create_notification() — the one function that writes `notifications`
  │  - idempotency check (notification_dedupe)
  │  - promotional-preference gate (notification_preferences)
  │  - fan-out to notification_deliveries: one 'in_app' row
  │    (delivered immediately) + one 'push' row per active device
  ▼
notifications row committed — Realtime-visible immediately (in-app),
push rows sit 'pending'
  │
  ▼ (async, up to 1 minute later — never blocks the transaction above)
pg_cron → pg_net → send-push-notifications Edge Function → Expo Push
Service → device
```

## Why business logic never touches a push provider

Every trigger function calls `create_notification()`, never Expo's
API directly — the mobile app doesn't either. The only thing that
knows Expo's push API exists is the Edge Function, which only runs on
a schedule, authenticated as `service_role`, with the provider
response feeding back into `notification_deliveries` (status/attempt
tracking) and `user_devices` (deactivating a token Expo reports dead).
This is the section 8/16 requirement ("business logic must NOT
directly depend on FCM/APNs") satisfied structurally, not by
convention — there is no code path from a trigger to an HTTP call.

## Related docs

- `docs/notification-events.md` — the full event → notification mapping and why
- `docs/push-notifications.md` — device tokens, the Edge Function, retries, Vault
- `docs/notification-security.md` — RLS, dedup, data minimization
- `docs/notification-testing.md` — what's covered by `phase10-notifications.test.mjs`
