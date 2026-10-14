# Store Manager Architecture

## Almost everything already existed

This phase's brief described a store fulfillment console in detail —
order queue, picking, packing, inventory, rider handoff, dashboard
counters, SLA pacing. Inspecting `app/store/**` (built across Phases
07/08/09/10) found nearly all of it already real and tested:

| Asked for | Already built | This phase added |
|---|---|---|
| Today's orders breakdown | `get_store_dashboard()` — New/Processing/Picking/Packing/Ready/Cancelled counts | `statusReason` field |
| Order queue with tabs | `app/store/orders/index.tsx` — New/Processing/Picking/Packing/Ready filters, urgency coloring | Realtime refresh (was focus-only) |
| Order state machine | `accept_order`/`reject_order`/`advance_order_fulfillment` (Phase 07) | *(untouched)* |
| Item-by-item picking | `mark_order_item_picked()` + checkbox UI in order detail | A picked/total progress bar + % |
| Packing → Ready | `advance_order_fulfillment(..., 'packed')` | A confirmation checklist gate (section 15/56) |
| Rider assignment/handoff | `assign_rider`/`auto_assign_rider`/`cancel_assignment` (Phase 08), full sheet UI | *(untouched)* |
| Live tracking | "Track Live Location" link to `app/track/[orderId].tsx` (Phase 09) | *(untouched)* |
| Store status (open/paused) | `is_active`/`is_accepting_orders`/`get_store_operational_status()`, pause toggle (Phase 07) | A reason field (section 7's "Store maintenance") |
| Inventory + adjustment | `app/store/inventory.tsx`, `record_inventory_adjustment()` with 6 reason codes | *(untouched)* |
| SLA pacing | Dashboard's "Today's Pace" card (avg accept/pick/pack/fulfillment minutes) | *(untouched)* |
| Priority/urgency thresholds | `services/timeAgo.ts`'s `orderUrgency()` — centralized, not scattered | *(untouched)* |
| Notifications | Phase 10's `NotificationService`, bell badge on the dashboard header | *(untouched)* |
| Cross-store RLS scoping | `is_store_staff(store_id)` on every store table (Phase 01 onward) | 12 new explicit tests, no policy changes needed |

## What was genuinely new

1. **Store activity feed** (section 40) — `get_store_activity()`, a new function merging `order_events` + `delivery_events` + `inventory_movements` (all natively `store_id`-scoped), surfaced at `app/store/activity.tsx`. Deliberately *not* built on the generic `audit_logs` table — see `docs/store-manager-security.md` for why.
2. **Realtime** (section 51/58) — the dashboard, order queue, and order detail screens now subscribe to `orders`/`delivery_assignments` changes for their store (`storeOpsRepository.subscribeToStoreActivity()`) and refetch on any change, rather than only refreshing on screen focus. Both tables were already in the `supabase_realtime` publication (added in Phase 09) — no publication change needed.
3. **Pause reason + packing checklist** — small, focused UI additions to already-working screens, not new architecture.

## Why so little needed building

This project's own operating principle across every phase — "the
backend is always the authority, extend what exists, never duplicate"
— means Phase 07 already built a *complete* fulfillment console when
it built store operations, not a stub. This phase is confirmation and
hardening (see `docs/store-manager-security.md`) plus the handful of
genuinely missing pieces above, not a rebuild — matching this phase's
own explicit instruction: "The Store Manager interface must be a
focused operational tool, NOT a copy of the Admin dashboard," and, by
extension, not a second copy of itself either.
