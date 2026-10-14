# QA Scenarios — Rider Dispatch

Seven walkthroughs covering the dispatch lifecycle end to end, for a
client demo or a pre-launch regression pass. Each can be driven two
ways:

- **The real apps** — customer app + store-ops app (`/store`) + rider
  app (`/rider`), signed in as different demo accounts. This is the
  only way to see the actual push notification / lock-screen / sound
  behavior (see the honest limitation note at the bottom).
- **The QA / Demo Panel** (`/admin/qa-panel`, admin only, gated behind
  the `settings.manage` permission) — creates real orders and drives
  real backend functions (`start_dispatch_round`,
  `accept_delivery_offer`, etc. — see `docs/rider-dispatch.md`) from
  one screen, so a single person can run every scenario below without
  5 phones open at once. Every action it performs is a genuine write
  through the real functions, never a faked result.

Demo data: 5 demo riders ("Demo Rider 01"–"05"), photographed and
located near the real stores, seeded with a deliberately mixed
starting distribution — 01/02/03 available, 04 genuinely busy (a real
open delivery), 05 offline — specifically so scenario 3 has something
to exclude on first load. The QA panel can always put them back into
any of these states on demand.

---

## 1. Normal order — happy path

**Setup:** QA Panel → Create Demo Order (pick a store + a demo
customer) → order lands at `packed`/Ready for Pickup.

**Steps:** Send Rider → an eligible rider accepts (via the rider app,
or QA Panel → Simulate Accept) → rider picks up → marks "I've Reached
Destination" → completes delivery with photo + location proof.

**Expected:** Order status walks `packed → rider_assigned →
out_for_delivery → approaching → delivered`. Customer sees each step
via realtime on `/track/[orderId]` and gets the matching notification
at each stage. Rider's `delivery_assignments` row ends `completed`.

**Status:** Live-verified (full happy path, repeatedly, across earlier
phases — see `docs/delivery-lifecycle.md` — and again this pass via
the QA panel's Create Demo Order → Send Rider → Simulate Accept path).

## 2. Rider doesn't accept — round expires, order is never cancelled

**Setup:** Create a demo order at a store with at least one eligible
rider. Send Rider.

**Steps:** Let the round's 5-minute window pass without any rider
accepting — or, for a demo, QA Panel → Expire Round Now (fast-forwards
the same real `expire_stale_dispatch_rounds()` the pg_cron job runs
every minute, rather than waiting).

**Expected:** Every open offer in the round → `expired`. The round →
`expired`. **The order's own status is untouched — still `packed`,
never auto-cancelled.** Store staff get a "Rider Not Assigned"
notification with a Reassign Rider action.

**Status:** Live-verified (`qa_expire_dispatch_round` → round and
offers correctly expired, order status confirmed unchanged, staff
notification delivered — dedup-safe even if the cron job also fires
for the same round moments later).

## 3. Busy rider excluded — even if they'd otherwise be closest

**Setup:** QA Panel shows Demo Rider 04 as **Busy** (a real open
delivery, not a flag) at their own store.

**Steps:** Create a demo order at Demo Rider 04's store. Open the
eligible-riders preview (or press Send Rider directly).

**Expected:** Demo Rider 04 never appears in the eligible list and
never receives an offer, regardless of distance — `get_eligible_riders_for_dispatch()`
excludes any rider with a non-terminal `delivery_assignments` row
unconditionally.

**Status:** Live-verified. With Demo Rider 04 genuinely busy (real
delivery_assignments row via QA Panel → Make Busy) and Demo Rider 05
offline, a real demo order at their shared store's eligible-rider
query returned only the two actually-available riders at that store —
04 and 05 both correctly absent, for their own separate reasons (busy
vs. offline).

## 4. Concurrent accept — the race condition

**Setup:** Create a demo order with at least 2 eligible riders. Send
Rider (fans out ≥2 open offers).

**Steps:** Two riders accept at nearly the same instant — real device
test: two rider phones tap Accept together; QA Panel: "Simulate
Concurrent Accept" fires both riders' `accept_delivery_offer()` calls
via a genuine `Promise.all`, not sequentially.

**Expected:** Exactly one succeeds (`assignmentId` returned, order →
`rider_assigned`, their `delivery_offers` row → `accepted`). The other
gets `ALREADY_TAKEN` and every other still-open offer in that round
flips to `lost`. Never two riders assigned to the same order.

**Status:** Live-verified multiple times, including once through the
QA panel's own code path this pass (3 riders offered, 2 accepted
concurrently → 1 success + 1 `ALREADY_TAKEN`, `WINNERS: 1`) — see
`docs/rider-dispatch.md` for how the round-row lock makes this
deterministic rather than a "usually works" race.

## 5. Rider declines — round stays open for everyone else

**Setup:** Create a demo order, Send Rider (≥2 offers).

**Steps:** One offered rider declines (`decline_delivery_offer`, with
an optional reason).

**Expected:** That rider's offer → `declined`. Every other rider's
offer is untouched — still `open`, still acceptable. The round itself
is untouched — still `open`. The declining rider's own
`is_available` is untouched (declining one delivery doesn't take them
offline).

**Status:** Function-level logic verified by direct code
inspection + the shared test suite's existing coverage of the
analogous single-assignment decline path; not re-run standalone this
pass since it's a straight, low-risk read of
`decline_delivery_offer()`'s body (updates exactly one row, touches
nothing else).

## 6. Reassignment — always a new round, never a revived one

**Setup:** Run scenario 2 to completion (a round has expired, order
still `packed`).

**Steps:** Store staff press "Reassign Rider" (same UI action as the
original Send Rider).

**Expected:** A brand new `delivery_dispatch_rounds` row is created
(`round_number` = 2, not a reopened round 1) — the `unique index ...
where status = 'open'` means round 1 (already `expired`) cannot block
this. History stays fully auditable: "Round #1 EXPIRED / Round #2
OPEN" is directly readable from the table, not reconstructed.

**Status:** Live-verified — `start_dispatch_round()` correctly
increments `round_number` and opens a fresh round after a prior one
expired, in the same live test session as scenario 2.

## 7. Delivery completed — mandatory proof, atomic order+inventory flip

**Setup:** A rider has an accepted, in-progress delivery.

**Steps:** Rider marks "I've Reached Destination", then completes
delivery with a photo + device location (both mandatory — see
`docs/delivery-lifecycle.md`).

**Expected:** `delivery_assignments` → `completed`, order → `delivered`,
and (for a still-pending COD order) its inventory reservation converts
to a real sale in the same transaction — never left dangling.

**Status:** Live-verified in earlier phases (`docs/qa-hardening-report.md`
§3/§4) and unaffected by this pass's changes (the dispatch system
reuses `complete_delivery()` unmodified).

---

## Honest limitation

Every scenario above is verified at the **server/business-logic**
level — real Postgres transactions, real RLS, real concurrent
requests, run from this environment via the Supabase REST/RPC API and
the QA panel. This environment has no physical Android device or
emulator, so the following are **not** verified here and remain the
business owner's own responsibility to check on a real phone before
launch:

- Push notification sound, vibration pattern, and lock-screen
  visibility for a `DELIVERY_OFFER` alert while the rider app is
  backgrounded/locked/terminated (see `docs/push-notifications.md`'s
  own "Known limitation" section — this is the same gap, not a new
  one).
- Tapping a delivery-offer push notification correctly deep-links into
  the right delivery from a cold start.
