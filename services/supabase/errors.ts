/**
 * Standardized catalogue-layer errors. Repositories throw these instead
 * of letting raw PostgREST/Postgres errors reach the UI — screens can
 * check `error.code` without knowing anything about Supabase.
 */

export type CatalogueErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'CATEGORY_NOT_FOUND'
  | 'STORE_NOT_FOUND'
  | 'INVALID_FILTER'
  | 'INVALID_SORT'
  | 'PRODUCT_UNAVAILABLE'
  | 'NETWORK_ERROR';

/** Friendly, safe-to-show text for when there's no better message available (never a bare enum code — see the "NETWORK_ERROR" leak this replaced). */
const FALLBACK_MESSAGES: Record<CatalogueErrorCode, string> = {
  PRODUCT_NOT_FOUND: "We couldn't find this product.",
  CATEGORY_NOT_FOUND: "We couldn't find this category.",
  STORE_NOT_FOUND: "We couldn't find a store for this.",
  INVALID_FILTER: 'That filter is not valid.',
  INVALID_SORT: 'That sort option is not valid.',
  PRODUCT_UNAVAILABLE: 'This product is currently unavailable.',
  NETWORK_ERROR: "We couldn't connect. Please check your connection and try again.",
};

export class CatalogueError extends Error {
  readonly code: CatalogueErrorCode;

  constructor(code: CatalogueErrorCode, message?: string) {
    super(message ?? FALLBACK_MESSAGES[code]);
    this.name = 'CatalogueError';
    this.code = code;
  }
}

// A raw Postgres/driver message ("duplicate key value violates unique
// constraint...", relation/column names, SQLSTATE detail) is never
// safe to show a user — but our own RPCs' `raise exception '...'` text
// (e.g. "not authorized for this delivery", "rider is at capacity")
// IS hand-authored specifically to be shown directly, and PostgREST
// surfaces it as this same `.message` field. Trusting only messages
// that don't look like raw driver output keeps the "never leak driver
// detail" guarantee while no longer discarding every other RPC's own,
// often much more specific, human-written explanation.
const UNSAFE_MESSAGE_PATTERN = /relation |constraint|column |duplicate key|violates|syntax error|permission denied for|does not exist/i;

/** Wraps a Supabase/PostgREST error into a CatalogueError, never leaking raw driver detail to the UI. */
export function toCatalogueError(error: unknown, fallback: CatalogueErrorCode = 'NETWORK_ERROR'): CatalogueError {
  if (error instanceof CatalogueError) return error;
  const rawMessage = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : null;
  const isSafeMessage = !!rawMessage && rawMessage.length > 0 && rawMessage.length < 200 && !UNSAFE_MESSAGE_PATTERN.test(rawMessage);
  return new CatalogueError(fallback, isSafeMessage ? rawMessage : undefined);
}
