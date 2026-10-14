# Final Pre-Launch QA / Hardening Report

**Date:** 2026-09-14
**Scope:** Full-app audit and hardening pass across the customer app, store-ops app, rider app, and admin console, ahead of handoff to the business owner.

---

## 1. Headline results

- **Live Supabase test suite: 239/241 checks passing** across all 13 suites (auth, catalogue, cart/wishlist, checkout/fulfillment, store operations, rider/delivery, live tracking, notifications, admin control center, catalogue management, cross-role security, staff invites, store-manager security). The 2 remaining failures are a single, external, already-diagnosed issue (§7).
- **TypeScript: clean** (`tsc --noEmit`, zero errors).
- **Production web build: clean** (`expo export --platform web`, exit code 0, no bundling errors).
- **Database consistency audit: clean.** 21 checks run directly against live data (orphaned records, duplicate/missing inventory rows, oversold stock, broken totals, reservation leaks, dangling non-terminal orders) — all 0 violations except one confirmed-benign, cosmetic data-hygiene item (§6).
- **7 real, previously-unreported bugs found and fixed this pass** (§4), most significantly a genuine inventory-accounting bug affecting every Cash-on-Delivery order (the app's default payment method).

## 2. Acceptance criteria checklist

| Requirement | Status |
|---|---|
| 20 real demo customer accounts, real Supabase Auth | ✅ Done — `+919000001001`–`020`, OTP code `123456` |
| 5 real demo rider accounts, real Supabase Auth | ✅ Done — `+919000001101`–`105`, split across both real stores |
| Every active product genuinely orderable | ✅ Verified — every active variant at 1000 units at both real stores |
| Every active variant at 1000 QA inventory, both real stores | ✅ Done via `qa_reset_inventory()`, re-confirmed after every test run |
| 24/7 QA ordering (store-hours bypass) | ✅ `qa_test_mode` feature flag, on |
| Nearest-store assignment logic intact (no hardcoding) | ✅ Unchanged, real geofencing via `find_serviceable_stores()` |
| Full realtime chain: customer → store → rider → customer | ✅ Live-verified with 2 fully concurrent orders, 2 stores, 2 riders — no cross-talk, no out-of-order events (§5) |
| "I've Reached Destination" + delivery completion | ✅ Built and live-verified end-to-end (§3) |
| Product image editing refreshes everywhere | ✅ Fixed and verified (root cause: missing persistence, not a cache bug) |
| Keyboard never hides inputs | ✅ Root cause fixed (shared bottom-sheet component); broader app already correctly configured |
| Reliable admin CRUD | ✅ Audited; one real gap found and fixed (Inventory screen realtime) |
| No stale-data bugs | ✅ Audited across admin + customer screens; issues found and fixed |
| Duplicate-action protection | ✅ Spot-checked across all critical buttons (checkout, OTP, rider actions, store actions) — all already correctly guarded by a consistent busy-state + disabled pattern from earlier hardening work |
| Working auth, intact RLS/security | ✅ No changes needed; all security-focused live tests pass |
| No exposed secrets | ✅ Confirmed — service-role key never touches client code, only CLI/scripts |
| No major crashes, no critical console/runtime errors | ✅ None found in this pass |
| Passing test suites | ✅ 239/241 (2 external, §7) |
| Passing TypeScript, build/export | ✅ Both clean |
| Proactively found bugs beyond what was reported | ✅ 7 real bugs found and fixed (§4) |

## 3. "I've Reached Destination" (explicit build item)

Backend: `mark_order_approaching()` (pre-existing, previously unreachable from any screen) is now wired to a real rider-facing button. `complete_delivery()` extended to accept the new `approaching` intermediate order status.

Rider UI (`app/rider/delivery/[id].tsx`): the photo-proof/confirm-delivery flow is now gated behind an explicit "I've Reached Destination" step — tapping it validates the rider owns the delivery, updates real order state, and only then reveals the delivery-completion flow.

Customer UI (`app/track/[orderId].tsx`): added a dedicated realtime subscription on the `orders` table (the existing subscription only covered `delivery_assignments`, which this status change never touches) so the customer sees "Your rider has reached your destination!" immediately, not on the next 25-second safety-net poll.

Resilience: `orderStatus` was added to both `get_rider_dashboard()` and the delivery-detail query so this state survives an app kill/reopen — it was previously tracked only in local component state, which is exactly the class of "reopen the screen" bug the hardening brief called out.

Verified live end-to-end with real demo accounts: order placed → correct store → packed → rider assigned → accepted → picked up → in transit → "I've Reached Destination" tapped → confirmed visible via realtime → delivery completed → order delivered. A second rider was confirmed unable to mark a delivery they don't own.

## 4. Bugs found and fixed this pass

| # | Bug | Root cause | Fix |
|---|---|---|---|
| 1 | Admin product image edits didn't appear anywhere after saving | `ProductWizard`'s Images step uploaded to storage but only persisted to the database as a side effect of a *different* step's save — navigating away any other way silently dropped the DB update | Every image mutation now persists immediately, matching the Variants/Inventory steps' own pattern |
| 2 | Bottom-sheet forms (store inventory adjust, order reject/assign/pack-confirm) could hide the focused input behind the keyboard | The one shared `AppBottomSheet` component had no keyboard-handling props and a non-scrolling content view | Added `keyboardBehavior`, `keyboardBlurBehavior`, `android_keyboardInputMode`, and switched to `BottomSheetScrollView` |
| 3 | **Every generic error, app-wide, displayed a bare code like `"NETWORK_ERROR"` instead of a real message** | `toCatalogueError()` discarded the original error entirely, including our own hand-authored, safe-to-show RPC exception text (e.g. "rider is at capacity") | Now preserves a safe underlying message when it looks human-authored (not raw driver/constraint text), and falls back to real friendly sentences instead of bare codes |
| 4 | **Cash-on-Delivery orders never converted their inventory reservation into a real sale** | `confirm_payment('paid')` is the only place that does `quantity -=`, but it's gateway-payment-only — COD orders are marked paid directly inside `complete_delivery()`, which never touched inventory at all. Found via a live database consistency audit, not a test — none of the existing tests asserted anything about inventory after a delivery completed. | `complete_delivery()` now performs the same sale-conversion for any order still in `pending` payment status; backfilled the reservation debt already accumulated in the QA database; added a live test asserting the inventory delta |
| 5 | (Self-inflicted while fixing #4, caught by the test suite before merging) `complete_delivery()`'s new inventory-movement insert used the wrong ID (`riders.id` instead of `profiles.id`) for its `created_by` column, causing every COD delivery completion to fail with a 409 | Foreign key mismatch | Corrected to `auth.uid()` |
| 6 | Every real delivery zone had `delivery_fee = 0` | Column default, never actually configured — meant every order got free delivery regardless of subtotal, contradicting the app's own "Free Delivery on orders above ₹499" messaging | Set to ₹49 (the value the pre-existing test suite already expected) — **owner should confirm this is the real number** |
| 7 | Admin Inventory screen didn't live-update when another admin (or a customer's order) changed stock | Every other admin list screen has a realtime subscription for its table; this one didn't | Added `subscribeToAdminInventory` |
| 8 | Several silent failures with no user feedback: profile-save errors, a stuck-forever search spinner on a failed search, a failed orders-list fetch rendering as "no orders" instead of an error state, the Categories screen having no loading/error/empty state at all | Missing `.catch()` / missing error-state UI in each case | Fixed individually, each now shows a friendly message with retry where appropriate |
| 9 | Admin numeric settings and inventory-adjustment forms accepted invalid input silently (non-numeric text became `NaN` → silently saved as `null`; invalid input on an adjustment modal just did nothing with no explanation) | Missing validation feedback | Added explicit validation with toast/inline error messages |
| 10 | Address form accepted any non-empty phone number or postal code (e.g. a 1-digit phone) | No format validation, only "non-empty" | Added real 10-digit phone / 6-digit pincode validation with inline hints |
| 11 | Admin top bar had no safe-area top inset on mobile-width admin sessions (title/bell icon could render under the status bar/notch) | Only the bottom tab bar had safe-area handling | Added `insets.top` to the top bar on narrow layouts |
| 12 | Admin Delivery Dispatch fleet map's rider-detail side panel used a fixed 260px width, squeezing the live map to ~50-70px on a phone-width admin session | Not `useWindowDimensions()`-aware | Stacks vertically below ~700px width instead |
| 13 | A few small icon touch targets (category edit button, product-image remove badges) under the ~40px comfortable minimum | No `hitSlop` | Added `hitSlop`; one pair of adjacent buttons was sized up instead of given overlapping `hitSlop`, to avoid making "Save" and "Delete" ambiguous at the boundary |
| 14 | Admin Products/Orders/Inventory search and filter boxes tore down and reopened their realtime channel on every keystroke | The realtime subscription's effect depended on the same `load` callback that the search box's own dependency array changes on every character | Decoupled via a new `useStableCallback` hook — the channel now opens once per screen visit and always calls the latest filtered `load` |

## 5. Realtime / concurrency stress testing

Ran two fully independent order lifecycles concurrently (different customers, different stores — Vijay Nagar and Awas Vikas, different riders) with live Supabase Realtime subscriptions open throughout, end to end from cart to delivered:

- **No cross-talk**: each customer's realtime channel only ever received events for their own order.
- **No out-of-order delivery**: both customers observed a strictly monotonic status sequence (confirmed → preparing → picking → packing → packed → rider_assigned → out_for_delivery → approaching → delivered).
- **No collisions**: both orders independently reached `delivered` at their correct, distinct stores.

Race conditions at the data layer (simultaneous same-SKU checkout, concurrent rider-capacity assignment, double-accept/double-tap protection) are exercised directly by the live Postgres test suite (phase04/05/08) and all pass.

## 6. Database consistency audit

21 direct-SQL checks against live data: orphaned `order_items`/`delivery_assignments`/`inventory` rows, duplicate inventory rows, missing inventory for active variants, oversold stock, negative quantities, order total mismatches, orders missing a store or delivery address, delivered orders missing timestamps, inactive riders with in-progress deliveries, and inventory reservation-leak detection.

All clean. One informational, non-functional finding remains: 24 test-fixture product variants are `is_active = true` under a now-inactive parent product. Verified this is harmless — both `add_to_cart()` and checkout's own availability check already join through the parent product's `is_active` flag, so these variants are correctly unreachable regardless of their own flag. Not a real bug; left as-is since it may be intentional (product hidden without individually re-flagging every variant).

Also cleaned up ~38 non-terminal orders accumulated across this project's long test-suite history (mostly under the deactivated Sanjay Place fixture store) via the real cancellation RPC, so the admin dashboard doesn't show phantom stuck orders on handoff.

## 7. Known issue requiring the owner's action (not fixed — needs external access)

**Staff invite emails fail** (`staff-email-invites.test.mjs`, 2 checks) with a generic "Error sending invite email" from Supabase's auth service. This is *not* the "no SMS provider configured" situation from earlier in this project — real Brevo SMTP credentials are configured (`smtp-relay.brevo.com`, sender `hr@aflix.co.in`). Most likely cause is that sender address isn't verified in the Brevo account, or the Brevo account itself needs attention — this requires access to the Brevo dashboard, which this session does not have. Everything else about staff invites (creation, authorization, the invite record itself) works correctly; only the actual email delivery fails.

## 8. Demo accounts

**Customers:** `+919000001001` – `+919000001020` ("Demo Customer 01"–"20")
**Riders:** `+919000001101` – `+919000001105` ("Demo Rider 01"–"05"), split across both real stores
**Login:** real phone-OTP flow via the app's normal Login screen, code `123456`
**Removal before production:**
```sql
delete from profiles where full_name like 'Demo Customer %' or full_name like 'Demo Rider %';
```
(`auth.users` rows need `admin.auth.admin.deleteUser()` per user — see the commented snippet at the bottom of `supabase/seed/04_seed_qa_demo_users.mjs`.) The test-OTP phone numbers can be left in the project's Auth config indefinitely without risk — they only work because no real SMS provider is wired up to send to arbitrary numbers.

## 9. What this pass did not cover

In the interest of accuracy (per "do not mark something passed merely because the code looks correct"):

- No visual/screenshot QA was performed — this environment has no way to render the app. All UI fixes were verified by code inspection and the established patterns already proven correct elsewhere in the codebase, not by looking at a rendered screen.
- No physical Android/iOS device testing — verification was via the live Postgres/REST layer and static analysis, not an installed build.
- No lint pass — this project has no ESLint (or other lint tool) configured; there was nothing to run.
- Performance was assessed by code review (subscription cleanup, pagination, debouncing) rather than profiling under real load.
