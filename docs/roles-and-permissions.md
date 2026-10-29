# Roles and permissions — who can do what, and what they can edit

Checked 2026-10-29 against the live database, not only the code. Each statement is marked with how it was checked:

* **[probed]** — tried for real as that role, inside a transaction that was rolled back. Repeatable: `supabase/tests/admin-role-matrix.test.mjs` (21 checks), `admin-rider-edit` (18), `admin-alignment` (20), `admin-promotions-zones` (29). Nothing was changed.
* **[policy]** — read from the database's own row-level-security policies, grants and function source. Not exercised.
* **[code]** — read from the app's screens and repositories. Not run on a device.

Five kinds of account exist: **customer**, **rider**, **store staff**, **store manager** and **admin** (which has six sub-roles).
Right now: about 47 customers, 10 riders (5 demo riders switched off), 4 store managers, 1 store staff, 2 admin accounts.

Migrations behind this document (all applied to production on 2026-10-29): `20260829000001` rider editing · `…02` admin alignment and order-cancel · `…03` two new permissions · `…04` banners, offers and zones · `…05` audited category switch.

---

## 1. Customer  [code, policy]

| Can | Notes |
|---|---|
| Sign in / register with a mobile number + OTP | The code is read from the SMS automatically (Android, new build). |
| Edit **own** name, email, photo | Phone number is the sign-in identity and cannot be edited. |
| Add, edit, delete, set-default **own** addresses | Pincode, landmark, house number, instructions. |
| Browse, search, wishlist, cart | Cart is checked on the server. The delivery fee and free-delivery bar now show the same numbers checkout charges. |
| Place an order (COD or online), track it live | |
| Cancel **own** order | Only while it is placed / confirmed / preparing. |
| Review products they bought, edit/delete own review | |
| Read own notifications, set notification preferences | |

Cannot: see anyone else's orders/addresses, change prices, stock, or any status other than cancelling their own early order. **Promo codes do not exist yet** (see Findings).

## 2. Rider  [policy, code]

| Can | Notes |
|---|---|
| Go online / offline | |
| Accept or decline an assigned delivery or an offer | |
| Mark arrived at store, confirm pickup by typing the order number, start delivery | The pickup box now lifts above the keyboard. |
| Mark "I've reached destination" | Customer is told. |
| Take the delivery photo and complete the delivery | Photo is required; it is now shrunk before upload and recovered if Android restarts the app. |
| Report a failed delivery with a reason | |
| Share live location while on a delivery | |
| Edit own name / email / photo | Same limits as a customer. |

Cannot: change their own vehicle, store, capacity or active status (direct writes to the `riders` table are locked **on purpose** [probed]), edit orders.

## 3. Store staff  [policy, code]

Works inside **their own store only**. Functions: accept / reject orders, mark items picked, advance picking → packing → ready, assign a rider and cancel an assignment, adjust stock (`record_inventory_adjustment`), switch an item's availability or its reorder level, read the store dashboard and activity feed.

Cannot: open or close the store for orders, resolve order exceptions, re-open an unavailable item, add or remove staff, see other stores, or edit the store's own details.

## 4. Store manager  [policy, probed]

Everything store staff can do, plus: **open / pause the store for orders** (with a reason), **resolve order exceptions**, **re-open an unavailable item**, and manage the store's staff (`assign_store_staff_role`, `create_staff_invite`, `deactivate_store_staff`).

**Changed 2026-10-29:** a store manager can **no longer rewrite their own store's row directly** (name, coordinates, "active"…). That was possible through the API although no screen offered it. The store app is unaffected: it reads the row and opens/pauses the store through a function [probed]. A store's details are edited by an admin (Admin → Stores → Edit details).

## 5. Admin  [probed]

`admin_role` decides what an admin can do. **owner** = the admin account whose role is empty (the original super admin). `super_admin` and `admin` now behave identically as "everything", except that only the owner and `super_admin` can grant the `admin` / `super_admin` roles.

| Admin role | Sees | Can change |
|---|---|---|
| **super_admin** / **admin** / owner | Everything: orders, riders, customers, inventory, deliveries, audit log, staff list | Products, variants, categories, stock, **stores**, **riders**, settings, feature flags, customers active/inactive, staff roles, **banners & offers**, **delivery pricing**. |
| **operations_manager** | Orders, deliveries, riders, customers, inventory, stores, analytics | Cancel orders, assign / reassign deliveries. Nothing in the catalogue. |
| **inventory_manager** | Inventory, products, categories, stores | Edit products, variants, categories; stock quantity and availability. No orders, customers, riders. |
| **delivery_manager** | Orders, deliveries, riders, stores | Assign / reassign deliveries; **edit riders**. |
| **support_agent** | Orders, deliveries, riders, customers | Nothing. Read-only. |

The two new permissions, `promotions.manage` (banners & offers) and `zones.manage` (delivery pricing), are held by no named role; they can be given to one with an insert into `role_permissions` [probed: a role given `promotions.manage` can use banners but still not zones].

### Matrix of what was actually tried (Y = worked, n = refused or invisible)

| Operation | owner | super | admin | ops | inventory | delivery | support |
|---|---|---|---|---|---|---|---|
| see orders | Y | Y | Y | Y | n | Y | Y |
| see riders | Y | Y | Y | Y | n | Y | Y |
| see customers | Y | Y | Y | Y | n | n | Y |
| see inventory | Y | Y | Y | Y | Y | n | n |
| see deliveries | Y | Y | Y | Y | n | Y | Y |
| see audit log | Y | Y | Y | n | n | n | n |
| see staff list | Y | Y | Y | n | n | n | n |
| edit product / variant / category | Y | Y | Y | n | Y | n | n |
| inventory availability flag | Y | Y | Y | n | Y | n | n |
| edit store phone / address / hours | Y | Y | Y | n | n | n | n |
| settings (business info) | Y | Y | Y | n | n | n | n |
| feature flags | Y | Y | Y | n | n | n | n |
| activate / deactivate a customer | Y | Y | Y | n | n | n | n |
| grant an admin role | Y | Y | Y | n | n | n | n |
| edit a rider's / customer's **name** | Y | Y | Y | n | n | n | n |
| write to the riders table directly | n | n | n | n | n | n | n |
| edit a rider through `admin_update_rider` | Y | Y | Y | n | n | Y | n |

---

## What the admin panel can edit, screen by screen

| Area | Editable in the app | Who | State |
|---|---|---|---|
| Products | Name, description, photos (crop/rotate), variants, prices, SKU, active | products.create / products.edit | Works |
| Categories | Name, description, image, parent, sort order, active | categories.manage | Works. The on/off switch is now audited (it was not). |
| Inventory | Stock quantity (with reason), availability, reorder level | inventory.manage / adjust | Works |
| Orders | Cancel; assign rider | orders.cancel, deliveries.assign | Works. Cancelling now also closes the order's delivery and frees the rider. No screen edits an order's items or address (orders are records). |
| Deliveries | Assign, reassign, cancel an assignment | deliveries.assign / reassign | Works |
| Stores | Name, phone, address, city, **opening and closing time**, accepting orders | stores.manage | **New** |
| Riders | Name, vehicle, vehicle number, home store, deliveries at once, active, photo | riders.manage | **Fixed** — the Active switch failed for everyone before |
| Customers | Active / inactive | customers.manage | Works. Name/email are the customer's own to edit. |
| Staff & roles | Invite, assign store role, assign admin role | users.manage | Works |
| Settings | Business name, support phone/email, low-stock level, delivery distance, feature flags | settings.manage | Works. **Two fields were removed** (see Findings 1). |
| **Delivery & Pricing** | Delivery fee, minimum order, free-delivery level, delivery time, area on/off, name | zones.manage | **New** |
| **Banners & Offers** | Title, subtitle, picture, button text, kind, what it opens, **start and end date**, order, on/off, delete | promotions.manage | **New** |
| Coupons | — | — | **Not a working feature** (Findings 2) |
| Zone boundaries (the drawn polygon) | — | — | Not editable and not used: serviceability is decided by distance from the store (Settings → delivery distance) |

---

## Findings

### Fixed 2026-10-29

1. **Settings → "Default Delivery Fee" and "Default Minimum Order" changed nothing** [probed, code]. Customers are charged the **delivery zone's** numbers (`resolve_checkout`); nothing read the two settings. The audit log shows someone editing them five times on the morning of 29 Oct (₹10, ₹300, ₹100 …) — no price moved. The fields are removed; the real ones are under **Delivery & Pricing**.
2. **The cart and checkout disagreed on the delivery fee**: the cart used a built-in ₹40 while the zones charge ₹49 [code]. The cart now asks the server (`get_delivery_pricing`) for the zone's fee, minimum and free-delivery level, and re-asks when the place changes or the app returns to the foreground. It hides the "add ₹X for free delivery" bar for an area that has no free-delivery level.
3. **Rider "Active" switch and rider edits failed for every admin** — `permission denied for table riders` [probed]. Now through `admin_update_rider` (audited; refuses to switch off or move a rider on a delivery).
4. **Cancelling an order left its delivery open and the rider busy** (a cancelled order's delivery sat "accepted" for days). It now closes the delivery, the open rider request and the dispatch round, so the rider is free at once [probed].
5. **The `admin` sub-role was not quite an admin**: `is_admin()` excluded it while the permission check and the app's own context included it. Aligned [probed]. Only the owner/`super_admin` can still grant the `admin` role.
6. **Store managers could rewrite their own store row** — removed (see §4) [probed].
7. **Permissions that nothing enforced**: `orders.manage` and `notifications.send` were granted to roles but checked by nothing — the two grants are removed. `orders.refund`, `products.delete`, `notifications.send` and `orders.manage` are marked in the database as reserved names (no refund, delete or broadcast feature exists). `notifications.view` only controls whether the Notifications entry shows in the admin menu; the notifications themselves are always the admin's own.
8. **A banner link of `//evil.example.com` was accepted by the first draft of the new function** and caught by its test; links must be a page inside the app (`/category/almonds`) — `//host`, `..`, `/./` and spaces are refused.

### Open — needs your decision

9. **Coupons are not a working feature, so there is no coupons screen.** No checkout function reads a coupon (the cart itself says "Promo codes aren't available yet"; `create_order_from_cart` has no discount parameter). The two seeded codes (`GP15`, `WELCOME50`) do nothing. The home-screen offer **"First Order Offer — Flat Rs.50 off with WELCOME50"** advertises a code customers cannot use: edit or hide it under Banners & Offers. Making coupons real means changing order creation and the online-payment amount (live Razorpay) — a separate piece of work, to be done and tested on its own.
10. **All 13 categories are switched off in production** (switched off one by one, about 3 seconds apart, between 05:51 and 05:59 UTC on 29 Oct). Customers see no categories. Not changed by this work: switch them back on under Admin → Categories if that was not intended. Who did it cannot be read from the log, because the switch was an unaudited table write; since migration `20260829000005` the switch goes through `admin_set_category_active` and every change is logged with the person's name [probed].
11. Banner and offer pictures are uploaded to the product-images store, which only allows uploads from roles that can create/edit products. The owner, `super_admin` and `admin` can; a role given only `promotions.manage` could change text and dates but not upload a picture.

### Not a bug, worth knowing

* `get_audit_logs` and the staff list answer "empty" or "not authorized" rather than an error when a role lacks the permission — correct, but a quick test that only checks "did it error" will wrongly report success.
* Anonymous (not signed in) callers have EXECUTE on a few helper functions (`check_serviceability`, `find_serviceable_stores`, `has_permission`, `is_admin`, `is_store_staff`, `get_store_operational_status`…). These are the ones row-level-security policies call, so they have to be executable; they return nothing about other users. `generate_order_number` is also in that list; whether an anonymous caller can draw from its sequence depends on the sequence's own grants, which was not tested.
* Two older live tests (`order-at-coordinates`, `serviceability-routing`) assumed a wider delivery distance than the live 2 km and failed for that reason alone (pins 2.2 km and 2.75 km from a store are correctly refused at 2 km). They now set the distance themselves inside their rolled-back run. The live distance is a business setting and tests do not touch it.
* The role-matrix table's last row was tried for the owner account and the delivery manager (and the refusals for the other three roles); `super_admin` and `admin` pass by the permission function's own rule (everything allowed) and were not tried one by one.
