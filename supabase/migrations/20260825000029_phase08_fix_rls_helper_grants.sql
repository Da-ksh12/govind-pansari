-- Fixes a mistake in the previous migration: revoking EXECUTE on
-- is_own_rider()/is_customer_of_rider_delivery() from `authenticated`
-- broke every policy that calls them. SECURITY DEFINER only changes
-- which privileges the function *body* runs with (bypassing RLS on
-- the tables it reads internally) — it does not exempt the function
-- *call itself* from needing an EXECUTE grant for whichever role is
-- evaluating the policy. is_store_staff()/is_admin() have always
-- worked from inside any policy for exactly this reason: they were
-- never revoked from their default PUBLIC grant. Match that here.
grant execute on function is_own_rider to public;
grant execute on function is_customer_of_rider_delivery to public;
