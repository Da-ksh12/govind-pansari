-- Govind Pansari backend — extensions and shared enum types.
--
-- This is the foundation migration: extensions used across the schema,
-- and the ENUM types shared by multiple tables. Kept separate from the
-- tables that use them so it's easy to see the full type vocabulary at a
-- glance.

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "postgis";        -- geography columns, ST_* functions
create extension if not exists "pg_cron";         -- scheduled cleanup / reservation-expiry jobs

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

create type user_role as enum ('customer', 'admin', 'store_manager', 'rider', 'staff');

create type store_staff_role as enum ('store_manager', 'staff');

create type weight_unit as enum ('g', 'kg');

create type stock_status as enum ('in_stock', 'low_stock', 'out_of_stock');

create type inventory_movement_type as enum (
  'purchase',
  'restock',
  'sale',
  'reservation',
  'reservation_release',
  'adjustment',
  'damage',
  'return',
  'transfer'
);

create type address_label as enum ('home', 'work', 'other');

create type coupon_discount_type as enum ('percent', 'flat');

-- Full order lifecycle, in chronological order. 'placed' is the initial
-- state created by checkout(); 'cancelled' can be reached from any
-- pre-delivery state.
create type order_status as enum (
  'placed',
  'confirmed',
  'preparing',
  'packed',
  'rider_assigned',
  'out_for_delivery',
  'approaching',
  'delivered',
  'cancelled'
);

create type payment_status as enum (
  'pending',
  'authorized',
  'paid',
  'failed',
  'refunded',
  'partially_refunded'
);

create type payment_method as enum ('upi', 'card', 'netbanking', 'wallet', 'cod');

create type delivery_assignment_status as enum (
  'assigned',
  'accepted',
  'picked_up',
  'in_transit',
  'completed',
  'cancelled'
);

create type notification_type as enum ('order', 'delivery', 'offer', 'payment', 'product', 'promotional');

create type review_status as enum ('pending', 'published', 'rejected');

create type banner_target_type as enum ('product', 'category', 'collection', 'url', 'none');
