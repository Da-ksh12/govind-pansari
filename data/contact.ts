/**
 * One place for every "call/message the business" number the app uses
 * — Help & Support's Call/WhatsApp buttons and the live-tracking
 * screen's "Call Rider" button all point here. This is a placeholder
 * pending the real Govind Pansari support line; update it here once
 * and every call site picks it up.
 *
 * "Call Rider" deliberately dials this same default number rather than
 * the rider's own phone — the backend still never returns a rider's
 * real number to the customer (see docs/tracking-security.md), so this
 * is a real, working button today (routes to the store) standing in
 * for masked/proxied rider calling, not a fake one.
 */
export const SUPPORT_PHONE_NUMBER = '+919876543210';
export const SUPPORT_WHATSAPP_NUMBER = '919876543210';
