# Admin panel — photos, variants & stock, orders, scrolling

Changed 2026-10-28. Nothing here touches the database schema or any RLS policy (no migration).

## 1. Product photos (Take Photo / Choose from Gallery / editor)

* **Sources.** The primary photo has *Take Photo* and *Choose from Gallery* buttons; gallery photos use an "Add photos" sheet with
  the same two options (the gallery picker allows several at once, edited one after another).
* **Camera permission** (`services/storage/productImages.capturePhoto`): asked only while Android will still show the prompt.
  Denied → "Try again" + the gallery alternative. Blocked for good → "Open Settings" (the prompt can never appear again).
  The system photo picker needs no storage permission.
* **Editor** (`components/admin/ImageEditorModal.tsx`): drag to reposition, pinch (or +/−) to zoom up to 5×, rotate in quarter turns,
  aspect 1:1 / 4:5 / 4:3 / 16:9, Reset, Preview (shows exactly what will be saved), Apply, Cancel; loading, open-error and
  apply-error states. Geometry is pure (`services/imageEditing.ts`, unit-tested incl. a randomised "crop never leaves the
  photo" check); pixels are produced by `expo-image-manipulator` (**~57.0.21, the SDK 57 version — the only new dependency**):
  rotate → crop → shrink to ≤1600 px → JPEG. The raw camera file is never uploaded.
* **Gallery:** preview, replace, move earlier/later, remove (with confirmation). The primary photo can be replaced, never removed.
* **No orphans, no duplicates.** *Create* mode keeps edited photos on the device and uploads each exactly once at **Publish**
  (a retried Publish reuses what it already uploaded; files uploaded for a product that was never published are deleted when the
  wizard is left). *Edit* mode uploads immediately and saves the product record; a replaced/removed file is deleted only after the
  record stopped pointing at it. One photo change runs at a time. Back/Next keep everything (one component holds the state).

## 2. Variants, SKU, pricing, stock

* Each variant is a card: **Weight / pack size**, **SKU — unique code** (with a *Suggest* button), **Selling price (₹)**, **MRP (₹)** — each
  with a label, an example placeholder, a one-line helper and, for SKU / MRP / low-stock alert, an (i) tip. A live "Customers save
  ₹X (Y% off)" chip, a "same size as variant N" note, **Duplicate** and **Remove / Archive** (confirmation when data would be lost).
* **Opening Stock** step: an explanation up top, then per variant → per store card with the **full store name** (it wraps, never
  truncated), *Opening stock (units)*, *Low-stock alert at*, and *Sell at this store*; "Same at all stores" copies the first store's numbers.
* **Review** shows, per variant: name, SKU, selling price, MRP, discount and the stock **per store** — built by the same helpers
  (`services/productWizard.ts`) that build what is sent. Validation (existing, unchanged rules) is shown inline.
* Verified live (rolled back): `supabase/tests/product-wizard-persistence.test.mjs` — 3 variants × 2 stores read back exactly; the
  database refuses duplicate/used SKUs, MRP < price, negative/fractional stock, 3-decimal prices, no photo, no variants.

## 3. Orders

* **Cards** (`components/admin/OrderCard.tsx`): order number (never wraps), status badge, date & time (IST), product photo + main
  product + "+ N more items", total (single line, `₹1,000` / `₹449.50`), item count, customer + phone, fulfilling store, rider, chevron.
  Phone ↔ permissions unchanged (the same RPC that already returned them).
* One column on a phone, two on a tablet, three on a wide window. Filters are one scrolling chip row; search is debounced;
  pagination and pull-to-refresh as before.
* **Photos/products come from the order's own stored lines** (`order_items`, readable with `orders.view`); if they cannot be read the card
  says "Items unavailable" — nothing is invented.
* **Details** (`app/admin/orders/[id].tsx`): items with photos, quantities, variant, SKU, unit price/MRP, line total; **Price details** exactly
  as stored (subtotal, discount, delivery, tax, total); **Payment** (method + status; "Paid (verified)" only if stored paid);
  customer (tap to call), address, fulfilling store, rider (tap to call), readable timeline, delivery proof. Actions: *Choose a rider*
  (packed, no rider, `deliveries.assign`), *Cancel order* (not delivered/cancelled, `orders.cancel`, confirmation that also works on web),
  *Live tracking*. Verified live against real records: `supabase/tests/admin-orders-data.test.mjs`.

## 4. Scrolling (Inventory and the screens that shared the problem)

**Root cause:** the stat cards and the whole filter toolbar were *siblings above* the `FlatList`. On a phone they took ~560 dp of an
~800 dp screen, so the list had a ~150 dp window to scroll in. **Fix:** they are now the list's `ListHeaderComponent` (passed as an
element so the search box keeps focus), so everything scrolls as one list; stat cards have a compact variant; `AdminShell`'s
`main`/`content` got `minHeight: 0`. Applied to **Inventory, Orders, Products, Riders, Deliveries** (the map keeps a fixed bar).
Store filter chips show short names (`Awas Vikas`); rows of the inactive Sanjay Place store are tagged "inactive store".

## How to test

```
npx tsc --noEmit
npm run test:unit                                           # 221 tests
node --env-file=.env supabase/tests/admin-orders-data.test.mjs          # read-only, real orders
node --env-file=.env supabase/tests/product-image-storage.test.mjs       # uploads + deletes one 1-pixel file
SUPABASE_ACCESS_TOKEN=… node --no-warnings --import ./tests/unit/register-ts-resolver.mjs supabase/tests/product-wizard-persistence.test.mjs   # rolled back
```

## Manual Android checklist (needs the new APK — it contains a new native module)

1. Products → Add Product → Images: *Take Photo* → allow camera → shoot → crop (drag, pinch, rotate, 4:5, Reset, Preview) → Apply → the photo shows.
2. Deny the camera once → "Try again"; deny with "Don't ask again" → "Open Settings" opens the app's settings page.
3. Gallery: add 3 photos at once, move one earlier, replace one, remove one (confirm). Go Next/Back — the photos are still there.
4. Variants: add 100 g / 250 g / 500 g with different SKUs/prices; try an MRP below the price, a repeated SKU, a negative stock — each is explained inline.
5. Stock: both full store names are readable; set different stock per store; Review lists SKU, price, MRP, stock per store; Publish; reopen the product — values match.
6. Orders: cards show photo, product, total on one line; filter chips scroll sideways; open an order — items, price details, payment, timeline.
7. Inventory: scroll from the stat cards to the bottom of a long list; type in the search box with the keyboard open; the bottom bar never overlaps the last card.

## Not verified / known limits

* **Nothing above was run on a phone** (no device here): camera, gestures, permission dialogs and the visual layout are verified by
  unit tests of the logic, live checks of the data path and a successful Android bundle — not on screen.
* If Android kills the app while the camera is open (low memory), the shot is not recovered (`getPendingResultAsync` is not wired); the admin retakes it.
* The photo is edited as a single image; re-cropping an already-uploaded photo is done by replacing it.
