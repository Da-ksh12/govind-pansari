-- Pre-production hardening, priority 1: the Admin Dashboard/Deliveries
-- screens now subscribe to riders + inventory changes (rider status,
-- low/out-of-stock alerts), same as the already-published
-- orders/delivery_assignments/rider_locations/notifications tables
-- (see 20260825000031_phase09_location_schema.sql). Without this, a
-- client-side .channel().on('postgres_changes', ...) subscription to
-- either table silently never receives any event — it does not error,
-- it just never fires, which would have made the new admin realtime
-- wiring look correct in code while doing nothing at runtime.
alter publication supabase_realtime add table riders;
alter publication supabase_realtime add table inventory;
