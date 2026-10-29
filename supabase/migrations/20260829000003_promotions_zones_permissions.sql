-- Two new admin permissions, so the home-screen banners/offers and the delivery pricing zones can be managed from the admin panel without being
-- tied to "settings". A new enum value cannot be used in the transaction that adds it, so this is a migration of its own; the functions that
-- check them are in the next one (20260829000004). Nobody holds them through a role by default: the super admin and 'admin' have every permission,
-- and a role can be given one later with an insert into role_permissions.
alter type admin_permission add value if not exists 'promotions.manage';
alter type admin_permission add value if not exists 'zones.manage';
