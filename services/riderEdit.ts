// Editing a rider from the admin panel: the limits (the same ones the database enforces in admin_update_rider), which fields changed,
// and what to tell the admin when the server refuses. Pure, so tests/unit covers it.

export const VEHICLE_TYPES = ['bike', 'scooter', 'bicycle'] as const;
export const MAX_ACTIVE_DELIVERIES_LIMIT = 10;

export interface RiderFormInput {
  fullName: string;
  vehicleType: string;
  vehicleNumber: string;
  primaryStoreId: string | null;
  maxActive: string;
}

export interface RiderCurrent {
  fullName: string;
  vehicleType: string;
  vehicleNumber: string;
  primaryStoreId: string | null;
  maxActive: number;
}

/** Only what changed; an absent key means "leave as it is" (the database function treats NULL the same way). */
export interface RiderPatch {
  fullName?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  primaryStoreId?: string;
  maxActiveDeliveries?: number;
  isActive?: boolean;
}

export type RiderFormErrors = Partial<Record<keyof RiderFormInput, string>>;

const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');

export function validateRiderForm(input: RiderFormInput, current: RiderCurrent): { errors: RiderFormErrors; patch: RiderPatch } {
  const errors: RiderFormErrors = {};
  const patch: RiderPatch = {};

  const fullName = collapse(input.fullName);
  if (fullName.length < 2 || fullName.length > 60) errors.fullName = 'Enter the rider\'s name (2 to 60 characters).';
  else if (fullName !== current.fullName) patch.fullName = fullName;

  const vehicleType = collapse(input.vehicleType).toLowerCase();
  if (vehicleType.length < 1 || vehicleType.length > 30) errors.vehicleType = 'Enter the vehicle type, e.g. bike.';
  else if (vehicleType !== current.vehicleType) patch.vehicleType = vehicleType;

  const vehicleNumber = collapse(input.vehicleNumber).toUpperCase();
  if (vehicleNumber.length < 1 || vehicleNumber.length > 20) errors.vehicleNumber = 'Enter the vehicle number (up to 20 characters).';
  else if (vehicleNumber !== current.vehicleNumber) patch.vehicleNumber = vehicleNumber;

  if (!input.primaryStoreId) errors.primaryStoreId = 'Choose the rider\'s home store.';
  else if (input.primaryStoreId !== current.primaryStoreId) patch.primaryStoreId = input.primaryStoreId;

  const max = /^\d{1,2}$/.test(input.maxActive.trim()) ? Number(input.maxActive.trim()) : NaN;
  if (!Number.isInteger(max) || max < 1 || max > MAX_ACTIVE_DELIVERIES_LIMIT) errors.maxActive = `Enter a number from 1 to ${MAX_ACTIVE_DELIVERIES_LIMIT}.`;
  else if (max !== current.maxActive) patch.maxActiveDeliveries = max;

  return { errors, patch };
}

export const RIDER_EDIT_MIGRATION_PENDING =
  'Editing riders needs a database update that has not been applied yet (migration 20260829000001). Ask the developer to apply it.';

/**
 * What to show when admin_update_rider fails. The function's own messages are written to be read ("this rider has a delivery in
 * progress — finish or cancel it first") and are passed through; a missing function means the migration is not applied yet; anything
 * that looks like raw database output is replaced.
 */
export function describeRiderEditError(error: { code?: string | null; message?: string | null } | null | undefined): string {
  const message = (error?.message ?? '').trim();
  if (error?.code === 'PGRST202' || /could not find the function/i.test(message)) return RIDER_EDIT_MIGRATION_PENDING;
  if (/not authorized/i.test(message)) return "You don't have permission to edit riders.";
  const looksRaw = /relation |constraint|column |duplicate key|violates|syntax error|permission denied|does not exist|schema cache/i.test(message);
  if (!message || message.length > 200 || looksRaw) return "Couldn't save the rider. Please try again.";
  return message;
}
