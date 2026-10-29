// Editing a delivery area's pricing — the numbers customers are charged. The same limits admin_update_zone enforces, and which fields changed. Pure,
// so tests/unit covers it.

export interface ZoneFormInput {
  name: string;
  deliveryFee: string;
  minimumOrderValue: string;
  /** Empty = this area has no free-delivery level. */
  freeDeliveryThreshold: string;
  estimatedMinutes: string;
}

export interface ZoneCurrent {
  name: string;
  deliveryFee: number;
  minimumOrderValue: number;
  freeDeliveryThreshold: number | null;
  estimatedMinutes: number;
}

/** Only what changed. `noFreeDelivery` switches the free-delivery level off (an absent amount means "unchanged"). */
export interface ZonePatch {
  name?: string;
  deliveryFee?: number;
  minimumOrderValue?: number;
  freeDeliveryThreshold?: number;
  noFreeDelivery?: boolean;
  estimatedMinutes?: number;
}

export type ZoneErrors = Partial<Record<keyof ZoneFormInput, string>>;

const money = (text: string): number => (/^\d{1,6}(\.\d{1,2})?$/.test(text.trim()) ? Number(text.trim()) : NaN);

export function validateZoneForm(input: ZoneFormInput, current: ZoneCurrent): { errors: ZoneErrors; patch: ZonePatch } {
  const errors: ZoneErrors = {};
  const patch: ZonePatch = {};

  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) errors.name = 'Enter the area name (2 to 80 characters).';
  else if (name !== current.name) patch.name = name;

  const fee = money(input.deliveryFee);
  if (!(fee >= 0 && fee <= 500)) errors.deliveryFee = 'Enter a delivery fee from 0 to 500.';
  else if (fee !== current.deliveryFee) patch.deliveryFee = fee;

  const min = money(input.minimumOrderValue);
  if (!(min >= 0 && min <= 5000)) errors.minimumOrderValue = 'Enter a minimum order from 0 to 5000.';
  else if (min !== current.minimumOrderValue) patch.minimumOrderValue = min;

  let free: number | null = null;
  if (input.freeDeliveryThreshold.trim() !== '') {
    free = money(input.freeDeliveryThreshold);
    if (!(free >= 1 && free <= 100000)) errors.freeDeliveryThreshold = 'Enter an amount, or leave it empty for no free delivery.';
  }
  if (!errors.freeDeliveryThreshold && free !== null && min >= 0 && free < min) {
    errors.freeDeliveryThreshold = 'Free delivery must start at or above the minimum order.';
  }
  if (!errors.freeDeliveryThreshold) {
    if (free === null && current.freeDeliveryThreshold !== null) patch.noFreeDelivery = true;
    else if (free !== null && free !== current.freeDeliveryThreshold) patch.freeDeliveryThreshold = free;
  }

  const eta = /^\d{1,3}$/.test(input.estimatedMinutes.trim()) ? Number(input.estimatedMinutes.trim()) : NaN;
  if (!(eta >= 5 && eta <= 240)) errors.estimatedMinutes = 'Enter minutes from 5 to 240.';
  else if (eta !== current.estimatedMinutes) patch.estimatedMinutes = eta;

  return { errors, patch };
}
