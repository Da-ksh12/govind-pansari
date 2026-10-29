# Tester report (32 cases) — status as of 2026-10-28

Source: `Govind_pansari_-_report_file.xlsx`. Every case was checked against the **current code**; the dashboard group was also
re-run against the live database (`supabase/tests/admin-dashboard-consistency.test.mjs`, 14/14). Nothing here was run on a phone.

| TC | Issue | Status | Evidence |
|---|---|---|---|
| 01 | Stepper labels overlap | Fixed earlier | Equal-width steps + short labels under 560 px (`ProductWizard` stepper) — checked in code, not on screen |
| 02 | Back button on Add Product | Fixed earlier | Footer Back steps back / leaves; hardware Back guarded (`goBack`, `interceptBack`) |
| 03 | Place Order inconsistent at same total | Fixed earlier | `services/checkoutGate.ts` — one decision for button, message and stepper; summary re-fetched when the cart changes |
| 04 | Disabled < ₹300, no minimum shown | Fixed earlier | Gate says "Add ₹X more… minimum is ₹300" |
| 05 | Revenue ₹50 low | Fixed earlier | Single documented definition (migration `…27000004`); live test 14/14 |
| 06 | Today's Revenue card not clickable | Fixed earlier | Opens analytics; live test confirms same figure |
| 07 | Active orders 29 vs 18 | Fixed earlier | Card, pipeline and Orders list share `is_active_order_status`; live test |
| 08, 09 | (passed) | Still pass | Live test |
| 10, 16 | Deliveries page empty although dashboard shows 3 | Fixed earlier | Ambiguous embed replaced by named relationship; live test |
| 11 | Assign Rider shows nothing | Fixed earlier | Needs-rider list matches the card; live test |
| 12 | "Change Payment Method" wraps | Fixed earlier | `shouldStackModalButtons` + single-line labels in `GPModal` |
| 13 | Raw gateway error shown | Fixed earlier | `services/payments/paymentErrors.ts` (unit tests) |
| 14 | Store revenue ₹0 | Fixed earlier | Per-store revenue = dashboard revenue definition; live test |
| 15 | Pipeline counts inconsistent | Fixed earlier | Stages add up to Active Orders; live test |
| 17 | Same image on products with no photo | Fixed earlier | No stock-photo guessing; neutral "GP" tile; photo mandatory on publish |
| 18 | Negative stock accepted | Fixed earlier | `parseWholeNumber` rejects it; DB rejects too |
| 19 | One SKU shown for all variants | Fixed earlier | Per-variant SKU on Review; duplicate SKUs rejected |
| 20 | MRP not guided / lower MRP allowed | Fixed earlier | MRP follows price until edited; MRP < price rejected |
| 21 | Packing proceeds with unavailable item | Fixed earlier | Migration `…27000005` (guards in `advance_order_fulfillment`, `resolve_order_exception`) |
| 22 | UPI order proceeds unverified | Fixed earlier | Migrations `…27000005/07/08`: unpaid online orders can't be accepted/packed; only verified payment marks paid. "Mapped to Awas Vikas" is the nearest store that has every item — expected |
| 23 | Payment tick before method chosen | Fixed earlier | `paymentStepState`; no default payment method |
| 24 | Vijay Nagar store got no notification | **Cause found + safeguards added** | See below |
| 25 | Publish without opening stock | Fixed earlier | `missingOpeningStock` blocks Next/Publish |
| 26 | Same price/MRP rejected? | No defect | Only SKU duplicates are rejected (`validateVariants`) |
| 27 | Premium label hidden with Best Seller | **Fixed now** | `visibleBadges` + `ProductBadgeStack` on card and product page |
| 28 | Form keeps previous product | **Guarded now** (could not reproduce) | Publish remounts a blank wizard (`new.tsx` key) |
| 29 | New low-stock product not in dashboard list | **Fixed now** (needs migration `…28000002`; works without it) | Root cause: list was "first 4 rows by id" |
| 30 | Place Order appears late after quantity change | **Improved** (not removable) | Debounce 250→120 ms; button visible with "Updating your total…" until the server confirms |
| 31 | Start button at bottom of rider screen | By design | Bottom-anchored primary action on every rider step; needs a product decision if it should move |
| 32 | No Back in Quick Action pages | **Fixed now** | Back button in `AdminShell` header on every page except the dashboard |

## TC-24 in detail

* `notify_on_order_created()` notifies the **active staff of the order's store**. Routing is correct: checkout only picks stores
  where every cart item is enabled and in stock, so a Vijay Nagar-only product goes to Vijay Nagar.
* Live staff: Vijay Nagar = **Pooja** (+919000000205) and **Demo Store Staff** (+919000000204); Awas Vikas = **Shikha**
  (+919000000203). **"Demo Store Manager 2 (Vijay Nagar)" (+919000000207) and "(Awas Vikas)" (+919000000208) have no store** —
  `supabase/seed/06_final_roster_reduction.mjs` deactivated them on purpose (one manager per store). Signing in as them can never
  show a store notification. **Not changed** — that was the owner's decision.
* Added: if an order's store has *no* active staff, every active admin gets an `admin_system_alert` that opens the order
  (migration `…28000002`); the admin Staff screen now shows "No store assigned — gets no orders or alerts" on such accounts.
* Not verified: push delivery to a physical device (needs a registered device token and the FCM setup).

## Applied to production (2026-10-28)

* `20260828000001_address_structure_and_lookup_limits.sql` and `20260828000002_inventory_attention_and_unstaffed_store_alert.sql`
  were applied after their rolled-back tests passed (17/17 and 13/13). Afterwards: live address save 6/6 (now stores every
  structured field), order-at-coordinates 23/23, serviceability-routing 49/49, dashboard consistency 14/14.
* **"Address not saving" was caused by the app sending the new address columns before the database had them** (PostgREST
  `PGRST204 Could not find the 'building' column`) — the database now has them. The app also falls back to the old columns if it is
  ever pointed at a database without them (`services/addressPersistence.ts`), and a failed Save now lists what is missing.

## Search screen overlap and storefront images (same day)

* **"Popular Right Now" under the search bar.** The Search screen wrapped its bar in `<View style={{ flex: 1 }}>` inside an auto-height
  column. That wrapper can be measured at zero height, collapsing the row to its 16 dp of padding and letting the 48 dp bar overflow on
  top of the list — which matches the screenshot (heading centre ≈ 50 dp from the top of the row). The bar now sits directly in the
  row and the row reserves its own height (`minHeight`, `flexShrink: 0`). Only that screen used the pattern. Not seen on a device.
* **Category images.** Live audit (`supabase/tests/storefront-images.test.mjs`, read-only): 12 active categories; 2 had no image —
  "Dry spices" and "Hbfkg" — and both are **empty** (0 products). Customers no longer see empty categories; a category with no
  image of its own borrows a real photo of a product inside it (its own first, then its sub-categories'), never a stock photo.
  The admin category form now requires an image and flags categories without one.
* **Product images.** 58 of 59 active products have a photo and all 69 category/product/gallery image URLs load as real images from
  your own storage (none broken, none shared between products). The one without a photo is the old test row **"jjllk"**
  (`red-chilli-powder`), which shows the neutral GP tile; archive or give it a photo in Admin → Products.

## Agra place data: "Civil Lines" → the block you are actually in (2026-10-29)

OpenStreetMap answers a pin in Vijay Nagar with the one big administrative suburb it knows ("Civil Lines", ~4 km wide) and has
no feature called Vijay Nagar at all. The picker now merges the provider's answer with a **local Agra gazetteer** (`data/agraPlaces.json`,
~182 KB, no network, instant), so the label is the closest block a customer would recognise. Details, sources, licences and how to
extend or rebuild it: [`data/README.md`](../data/README.md).

* **Data gathered:** 247 localities (171 colonies, 66 areas, 10 Awas Vikas sector entries), 611 named roads, 1,132 landmarks, 336
  postcode points and 234 post-office areas — from OpenStreetMap (Overpass), India Post, GeoNames postal codes and Wikidata. The
  app's own stores are added as anchors at run time ("Vijay Nagar Colony, Agra" at the store's coordinates).
* **Results on real data:** the Vijay Nagar store pin → "Vijay Nagar Colony, Agra 282004"; the Awas Vikas store → "Sector 11, Awas
  Vikas Colony 282007"; Wazirpura Road → "Wazirpura Road, Sanjay Place 282002". Pincodes agree with the postcodes mapped near each
  store (Vijay Nagar 282004, Awas Vikas 282007 ×19 points, Sanjay Place 282002 ×29).
* **Rules:** the closest block wins (a sector beats its colony; a huge suburb is only a last resort); street only within 60 m of a
  mapped road; landmark within 250 m is *offered* as a chip, never filled in; pincode only with evidence (≥3 nearby tagged addresses
  agreeing 70%, else the India Post area name within 1.2 km, else blank); a house number is never invented; where the data knows
  nothing the provider's answer is returned unchanged. Google's own pincode is the only provider pincode allowed to stand.
* **Tests:** `tests/unit/agra-places.test.mjs` (31, including the real data and both stores); each rule was mutation-checked
  (the survivors found — store-anchor radius, landmark cut-off, bracket stripping — now have tests).
* **Limits:** OpenStreetMap lists only Awas Vikas sectors 1, 3, 4, 6, 7, 8, 11 and 16 A; lane-level detail and "every small place" do not exist in any
  free source I could reach (Overpass, GeoNames, Wikidata and India Post are exhausted; Overture/Foursquare are too heavy on this
  link; Google needs keys). Add the missing ones to `data/agraPlaces.extra.json` — no build step. Not run on a device; **needs the
  new APK (versionCode 15)**. The map views hide OpenStreetMap's attribution and the About screen has no credit line — add one
  before a wide release (ODbL / CC-BY).

## Rider delivery photo: the app reloads after the photo (2026-10-29)

**Symptom:** a rider takes the delivery photo and the app restarts. **No device log was available, so the cause is not confirmed**; the
fix removes the two causes that the installed library code (expo-image-picker 57.0.20, expo-image-manipulator 57.0.21) makes likely.

1. *Memory.* The camera step used `quality: 0.8` + `base64: true`. On Android that makes the picker decode the **whole** camera photo
   into a bitmap (≈50 MB at 12 MP, ≈200 MB at 50 MP), write it as JPEG, compress it **again** for the base64, copy it to a byte
   array and then to a string. Phones with big sensors and little RAM can run out of memory and the app dies.
   Now the picker gets `quality: 1, base64: false` (it just copies the camera's file) and the photo is shrunk **once**
   (`shrinkProofPhoto`: upright, longest edge 1280 px, JPEG 0.75 ≈ a few hundred KB) and released. Uploads are also far smaller
   (≈0.3 MB instead of up to 5 MB), which helps on weak mobile data.
2. *Android killing the app while the camera is open.* Documented behaviour; the picked photo is only retrievable with
   `ImagePicker.getPendingResultAsync()` after the restart, and the restarted app starts on the splash screen. Nothing in the app called
   it, so the photo and the rider's place were lost. Now a marker (`gp-pending-proof-capture`, AsyncStorage, 30 min) records which
   delivery a photo was being taken for; the restarted app goes splash → rider home → straight back to that delivery, which asks for the
   lost photo (`recoverInterruptedProofPhoto`, 3 tries 1.2 s apart because the result arrives a moment after the app). If no photo comes
   back the rider is told to take it again.

Files: `services/proofPhoto.ts` (rules, pure), `services/storage/{deliveryProof,imageProcessing}.ts`, `app/rider/delivery/[id].tsx`,
`app/rider/index.tsx`. Tests: `tests/unit/proof-photo.test.mjs` (10, mutation-checked). **Not run on a device** — the recovery path
needs a real Android kill to exercise (Developer options → "Don't keep activities" reproduces it). Needs a new APK.
The admin product-photo camera (`services/storage/productImages.ts`, quality 0.9) has the same two exposures; not changed here.

## Profile asked again after logout, SMS auto-read, admin editing, two layout fixes (2026-10-29)

* **"It asks for my name again after logout."** The server keeps the name: a rolled-back test as a real signed-in account saved a name and read it
  back. What the app did wrong: it read a profile that **failed to load** (one dropped request on a weak connection) as a profile with **no name**,
  and sent the customer to the name form. Now: the profile is read with up to 3 tries from the id the session already carries (no extra
  `getUser()` round trip); a failed read never erases a profile already loaded for the same user; and if it still cannot be read, the start screen
  says "Couldn't load your account — Try again" instead of showing the form. The name form also checks the server first and skips itself when the name is there.
  One real account (phone ending 0299, 3 orders) genuinely has **no name saved**, and six email sign-ups never entered one — those will still be asked, correctly.
  Files: `services/{retry,startupRoute,profileState}.ts`, `store/authStore.ts`, `app/{index,otp,welcome}.tsx`. Tests: `profile-persistence.test.mjs` (13).
* **SMS auto-read (Android).** New local native module `modules/sms-user-consent` using Google's SMS User Consent API: **no SMS permission and no app hash
  in the message**, so the DLT-approved template stays as registered. Google shows its own one-tap "Allow this app to read this message?" and the code
  fills in and signs in. It stops when the screen closes, re-arms after Resend, and is optional (iOS / old builds fall back to typing and the
  keyboard's code suggestion). A pasted message now yields just the 6-digit code. Verified: autolinking discovers the module and its class; names, API
  and cleanup are pinned by `otp-autofill.test.mjs` (9). **Not compiled and not tried on a phone** — it needs the next APK build; if Gradle
  complains, send me the first error lines.
* **Admin editing.** Stores: new "Edit details" (name, phone, address, city, opening/closing time). Riders: "Edit details" + a working Active switch,
  through the new function `admin_update_rider` — **migration `20260829000001` is written and tested (18/18, rolled back) but NOT applied.**
  Role report with the verified permission matrix: `docs/roles-and-permissions.md`; live tests `admin-role-matrix` (21) and `admin-rider-edit` (18).
* **Layout fixes.** Admin Deliveries cards on a phone are now two-line cards (the order number no longer wraps letter by letter; the rider name no longer
  runs into the price). The rider's "Confirm Pickup" box lifts above the keyboard (edge-to-edge Android does not resize the window, so the screen now
  measures the keyboard itself). Tests: `layout-fixes.test.mjs` (11). Not seen on a device.
* **Release build.** `com.razorpay:standard-core` is pinned to 1.7.20 (its parent library asked for "LATEST", which failed offline). `versionCode` is now 16.

## Open admin work, done (2026-10-29, later)

All five open items from the role report, plus what the work turned up. **Applied to production and recorded**: migrations `20260829000001`–`…05`.

* **Rider edits / Active switch** (`admin_update_rider`) — applied; tests 18/18 against the live database.
* **`admin` sub-role = admin; store managers can no longer rewrite their store row; cancelling an order closes its delivery and frees the rider; two
  grants that did nothing removed; `get_delivery_pricing`** (`…02`) — 20/20. Older suites re-run afterwards: manual-rider-assignment 25, order-at-coordinates 23,
  serviceability-routing 49, new-customer-rights 20, profile-after-verification 11, dashboard 14, orders-data 25, cross-role-escalation 8, address-save 6,
  address-structure 17, inventory-attention 13. Two of them (`order-at-coordinates`, `serviceability-routing`) had been failing only because someone lowered the
  live delivery distance to 2 km; they now pin their own distance inside the rolled-back run.
* **New screens**: *Delivery & Pricing* (fee, minimum order, free-delivery level, minutes, area on/off) and *Banners & Offers* (picture, text, what it opens,
  **start and end date**, order, on/off, delete). New permissions `zones.manage`, `promotions.manage` (`…03`, `…04`) — 29/29.
* **The cart now shows what checkout charges.** It used a built-in ₹40 delivery fee and ₹499 free level; the zones charge ₹49. It asks the server and follows
  an admin's change when the app comes back to the foreground. Hides the free-delivery bar for an area that has none.
* **Settings: two price fields removed.** "Default Delivery Fee" / "Default Minimum Order" were read by nothing; the audit log shows them edited five times on
  29 Oct with no effect. Prices are set per delivery area under Delivery & Pricing.
* **Category on/off switch audited** (`…05`, 6/6). All 13 categories were switched off on 29 Oct 05:51–05:59 UTC and the log could not say by whom.
* **Coupons: deliberately not built.** They are not a working feature (the cart says "Promo codes aren't available yet"; no checkout function reads a coupon). The Help
  FAQ that said otherwise is corrected. A coupons screen would edit something with no effect. Making coupons real changes order creation and the live
  Razorpay amount — separate work, needs your go-ahead.
* A first draft of the banner-link rule let `//evil.example.com` through; its test caught it before anything was applied, and the rule now allows only a page inside the app.
* **Open and not mine to change:** all 13 categories are still switched off (customers see none); the offer "Flat Rs.50 off with WELCOME50" advertises a code that does nothing.
* Final state: **482 unit tests pass**, type-check clean, Android bundle exports; **16 live database suites pass** (admin-rider-edit 18, admin-alignment 20,
  admin-promotions-zones 29, admin-role-matrix 21, admin-category-switch 6, manual-rider-assignment 25, order-at-coordinates 23, serviceability-routing 49,
  new-customer-rights 20, profile-after-verification 11, dashboard-consistency 14, orders-data 25, cross-role-escalation 8, address-save 6, address-structure 17,
  inventory-attention 13). Mutation checks on every new rule (one equivalent mutant noted: an end date can never equal a start date, since an end is 23:59:59 and a start 00:00:00).
