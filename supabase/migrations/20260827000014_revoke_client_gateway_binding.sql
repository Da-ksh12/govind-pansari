-- Razorpay hardening, phase 2 of 2: with create-razorpay-order now binding through
-- bind_payment_gateway_order() (service role), clients lose the ability to choose
-- which Razorpay order an application order is tied to. Apply AFTER the new
-- create-razorpay-order is deployed — the previous version calls this function
-- with the customer's own session.
--
-- Rollback: grant execute on function set_payment_gateway_order(uuid, text) to authenticated;
--           (only if the old create-razorpay-order is redeployed; the hole it reopens is
--           described in 20260827000013).

revoke all on function set_payment_gateway_order(uuid, text) from public, anon, authenticated;
