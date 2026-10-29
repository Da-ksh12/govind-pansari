# Realtime synchronisation

Changed 2026-10-28. Code: `services/realtime/` · tests: `tests/unit/live-feed.test.mjs`, `tests/unit/realtime-wiring.test.mjs`,
`supabase/tests/realtime-live.test.mjs`.

## Which Supabase mechanism, and why

| Data | Mechanism | Why |
|---|---|---|
| Orders, delivery assignments, riders, inventory, catalogue, notifications, dispatch offers | **Postgres Changes** | Low volume (two stores). The rows are authoritative and already protected by RLS; Realtime checks RLS for every row against the subscriber's own JWT, so there is nothing extra to secure. |
| Rider GPS pings (`rider_locations` INSERT) | **Postgres Changes**, filtered by `delivery_id` | Each ping is persisted anyway (outlier audit, last-known position) and RLS already says who may read it (`rider_locations_read`: the rider, admins, the customer of that rider's active delivery). One active delivery sends at most one ping per 5 s. At today's scale (a handful of simultaneous deliveries) Postgres Changes is well inside its limits. |

**When to move location to Broadcast:** if simultaneous deliveries grow past roughly 50–100 (Postgres Changes evaluates RLS per
subscriber per row on a single thread), switch the *ping fan-out* to a private Broadcast channel per delivery
(`realtime.messages` RLS policy built from the same `is_customer_of_rider_delivery()` check) while still persisting the row.
Nothing in the screens would change — only `trackingRepository.subscribeToLocation`.

## One layer, `liveFeed`

Every subscription goes through `services/realtime/liveFeed.ts` (core logic in `liveFeedCore.ts`, unit-tested with a fake
socket and run against the real service). Screens and repositories never open a channel themselves — a static test fails
the build if anything else calls `.channel(` / `removeChannel(` / `postgres_changes`.

* **One channel per table + filter**, however many screens listen (expo-router keeps earlier screens mounted). A second
  listener adds a callback, not a channel.
* **Exact cleanup.** The last listener to leave removes the channel; unsubscribing twice is harmless; a stale unsubscribe
  cannot close a newer channel; nothing is delivered after unsubscribe.
* **Bursts collapse.** `watch()` gives a screen at most one "refetch" call per 300 ms window (leading + trailing), so updating
  50 inventory rows is one reload.
* **Gaps are never ignored.** Postgres Changes does not replay. If a channel drops (`CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`)
  and comes back, every listener is told to refetch. A screen is also caught up **once when its channel first becomes ready**:
  joining took several seconds on a slow network in testing, and anything that changed in that window would otherwise be lost.
* **Foreground.** Screens call `useRefetchOnForeground`; the signed-in-lifetime stores (orders, notifications) ask the feed to
  resync on foreground (`resyncOnForeground`).
* **Quiet refreshes.** A live refresh (`load(true)`) keeps the screen as it is and never replaces a good list with an error;
  only a first load / retry reports failure. After a mutation the screen updates itself immediately (e.g. admin cancel shows
  *Cancelled* at once) and the server copy then replaces it.

## What updates live

| Screen | Subscribes to |
|---|---|
| Admin dashboard | orders, delivery_assignments, riders, inventory |
| Admin orders list | orders, delivery_assignments |
| **Admin order detail** (new) | that order's row + its delivery_assignments (`id=eq`, `order_id=eq`) |
| Admin deliveries list / map | delivery_assignments, riders |
| **Admin delivery detail** (new) | that assignment (`id=eq`) |
| Admin inventory / products / riders | inventory / products+variants+categories / riders |
| Store dashboard, orders, order detail | orders + assignments of that store (`store_id=eq`) |
| **Store inventory** (new) | inventory of that store |
| Rider dashboard / delivery | that rider's assignments; the assignment's status |
| Customer orders list and order detail | the customer's orders (`user_id=eq`) via the orders store |
| **Customer tracking** (reworked) | from the moment the order is placed: the order row + its assignments (so *Tracking will start soon* turns into the live map by itself when a rider is assigned); while a delivery leg is live: that delivery's `rider_locations` pings. Torn down when the order finishes. |
| Notifications | the customer's notifications (de-duplicated against reloads) |

One status change reaches the customer, the store and every admin screen because they all listen to the same `orders` /
`delivery_assignments` rows; there is no per-screen copy of the truth.

## Rider location

* Real GPS only (`expo-location`), sent through `submit_rider_location()` (never a direct write). The rule for what may be sent
  is `services/location/riderFixPolicy.ts`: the reading must be **fresh** (the phone's own timestamp ≤ 20 s old — a cached fix is
  dropped), **precise enough** (accuracy ≤ 150 m), **valid** (not 0,0 / out of range) and throttled to **one per 5 s**. A failed
  send is dropped, never queued, so an old position can never arrive later dressed as current.
* A stopped rider produces no movement events, so after 30 s of silence a **fresh** reading is requested (heartbeat) — otherwise
  a rider waiting at a junction would look "lost". Heartbeat < stale window (90 s) is asserted in a test.
* The server stamps `recorded_at` on receipt and stores `accuracy`. The customer card shows **"Updated 12 s ago · ±20 m"**,
  marks the position *approximate* above 100 m and *stale* after 90 s ("Waiting for the rider's next location update…"), and
  says **"You're offline — showing the last known position"** when the customer's own phone is offline.
* **Background location is NOT implemented and not promised.** Android stops delivering GPS to an app in the background unless it
  runs a foreground service with the background-location permission and a Play Store declaration — that needs real-device
  testing this project has not done. The rider screen says *"Keep this app open — sharing pauses when the app is in the
  background and resumes when you come back"*; sharing restarts by itself when the app returns to the foreground, and a rider
  who reopens the app lands on the dashboard, which resumes sharing for a leg in progress. `app.json` requests only foreground
  location (a test pins this).
* Access: unchanged and verified earlier — only the rider, admins, store staff of that store and the order's own customer can
  read a delivery's location (`get_delivery_tracking`, `rider_locations_read`).

## Verified live (against the production Realtime service, real sessions, no orders created)

`supabase/tests/realtime-live.test.mjs` — 17 checks: two listeners share one channel; an admin receives a rider change without
refreshing, exactly once, with the right value; a customer with no delivery for that rider and an anonymous client receive
nothing (RLS); a change made while the admin socket is down is *not* replayed (so the resync matters); after reconnect the layer
asks for a refetch and live events flow again; after unsubscribing no channel is left open and nothing more is delivered. The
only data written: the QA rider toggles its own availability and it is put back.

## Not verified here

* Nothing was run on a phone: background/foreground transitions, Android OS pausing the socket, GPS permission dialogs and the
  real feel of the live map are untested on a device.
* The full chain *rider action → customer + admin screens* with a real order was not executed against production without
  authorisation to create test orders; the pieces (feed, RLS, reconnect, screen wiring) are each verified above.
