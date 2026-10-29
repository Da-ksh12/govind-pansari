/**
 * Saving an address must never fail just because the app and the database are on different versions.
 *
 * The structured address fields (house number, building, floor, street, locality, formatted address, place id, delivery
 * instructions, geocode source) are added to the `addresses` table by migration 20260828000001. An app build that sends them
 * to a database that does not have them yet is refused by PostgREST (PGRST204 "Could not find the 'building' column"), and the
 * customer could not save ANY address. When that happens the save is retried with the long-standing columns only, and the
 * details are folded into them so nothing the customer typed is lost: the house/floor/building/street are already inside
 * address_line_1, the area is address_line_2, the landmark has its own column, and the delivery instructions are appended to
 * address_line_2 (which riders, store staff and admins already see).
 */

export const STRUCTURED_COLUMNS = [
  'house_no',
  'building',
  'floor',
  'street',
  'locality',
  'formatted_address',
  'place_id',
  'delivery_instructions',
  'geocode_source',
] as const;

interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

/** PostgREST says PGRST204 for an unknown column in the request; Postgres itself says 42703. */
export function isMissingColumnError(error: DbErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  const message = error.message ?? '';
  return /could not find the '[^']+' column/i.test(message) || /column "?[a-z_]+"? of relation "?addresses"? does not exist/i.test(message);
}

/** The same row with only the columns every database version has; the delivery instructions travel inside address_line_2. */
export function withoutStructuredColumns(row: Record<string, unknown>): Record<string, unknown> {
  const legacy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!(STRUCTURED_COLUMNS as readonly string[]).includes(key)) legacy[key] = value;
  }
  const instructions = typeof row.delivery_instructions === 'string' ? row.delivery_instructions.trim() : '';
  // Only when the row is writing address_line_2 itself (a create, or an edit of that field): a partial update must never
  // overwrite the line it was not asked to touch.
  if (instructions && 'address_line_2' in row) {
    const line2 = typeof legacy.address_line_2 === 'string' ? legacy.address_line_2.trim() : '';
    legacy.address_line_2 = [line2, `Note: ${instructions}`].filter(Boolean).join(' — ');
  }
  return legacy;
}

/**
 * Remembers that the database lacks the structured columns so every save does not pay for a failed attempt first. The memory
 * expires, so once the migration is applied the app starts using the new columns again without being reinstalled.
 */
export function createStructuredColumnMemory(now: () => number = Date.now, ttlMs: number = 10 * 60_000) {
  let missingUntil = 0;
  return {
    shouldTryStructured: () => now() >= missingUntil,
    markMissing: () => {
      missingUntil = now() + ttlMs;
    },
  };
}
