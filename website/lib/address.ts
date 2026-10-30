import { z } from 'zod';

// A delivery address as the customer types it, and the pieces the database stores. Same rules and the same composed "line 1" as the mobile app
// (services/addressForm.ts), so an address saved on either shows up correctly on both.

export const ADDRESS_LABELS = ['home', 'work', 'other'] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

const tenDigits = (v: string) => v.replace(/\D/g, '').replace(/^91/, '');

export const addressSchema = z
  .object({
    label: z.enum(ADDRESS_LABELS),
    receiverName: z.string().trim().min(2, "Enter the recipient's name.").max(80, 'That name is too long.'),
    receiverPhone: z.string().trim().refine((v) => /^[6-9]\d{9}$/.test(tenDigits(v)), 'Enter a valid 10-digit mobile number.'),
    houseNo: z.string().trim().min(1, 'Enter the house / flat / shop number.').max(100, 'That is too long.'),
    building: z.string().trim().max(100, 'That is too long.'),
    floor: z.string().trim().max(40, 'That is too long.'),
    street: z.string().trim().max(160, 'That is too long.'),
    locality: z.string().trim().max(160, 'That is too long.'),
    landmark: z.string().trim().max(200, 'That is too long.'),
    instructions: z.string().trim().max(500, 'Keep delivery instructions under 500 characters.'),
    city: z.string().trim().min(1, 'Enter the city.').max(80),
    state: z.string().trim().min(1, 'Enter the state.').max(80),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit postal code.'),
  })
  .superRefine((v, ctx) => {
    if (!v.street && !v.locality && !v.building) {
      ctx.addIssue({ code: 'custom', path: ['street'], message: 'Enter the street, building or area so the rider can find you.' });
    }
  });

export type AddressForm = z.infer<typeof addressSchema>;

const floorText = (floor: string) => {
  const f = floor.trim();
  if (!f) return '';
  return /floor/i.test(f) ? f : `${f} floor`;
};

/** address_line_1: everything a rider needs to find the door, in reading order. */
export function composeLine1(f: Pick<AddressForm, 'houseNo' | 'building' | 'floor' | 'street'>): string {
  return [f.houseNo, f.building, floorText(f.floor), f.street].map((p) => p.trim()).filter(Boolean).join(', ');
}

/** address_line_2: the area. */
export function composeLine2(f: Pick<AddressForm, 'locality'>): string | null {
  return f.locality.trim() || null;
}

export type GeocodeSource = 'google' | 'osm' | 'device' | 'manual';

const orNull = (v: string): string | null => (v.trim() ? v.trim() : null);

/** The database row for a new address. Blank optional fields are stored as NULL (not provided), never as empty text. */
export function toAddressRow(userId: string, f: AddressForm, position: { lat: number; lng: number; source: GeocodeSource; formatted?: string | null }) {
  return {
    user_id: userId,
    label: f.label,
    recipient_name: f.receiverName,
    phone: tenDigits(f.receiverPhone),
    address_line_1: composeLine1(f),
    address_line_2: composeLine2(f),
    landmark: orNull(f.landmark),
    city: f.city,
    state: f.state,
    postal_code: f.pincode,
    latitude: position.lat,
    longitude: position.lng,
    house_no: orNull(f.houseNo),
    building: orNull(f.building),
    floor: orNull(f.floor),
    street: orNull(f.street),
    locality: orNull(f.locality),
    formatted_address: orNull(position.formatted ?? ''),
    delivery_instructions: orNull(f.instructions),
    geocode_source: position.source,
  };
}

/** A saved address as the website lists it. */
export interface SavedAddress {
  id: string;
  label: AddressLabel;
  receiverName: string;
  receiverPhone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  lat: number;
  lng: number;
  isDefault: boolean;
}

interface AddressRow {
  id: string; label: AddressLabel; recipient_name: string; phone: string; address_line_1: string; address_line_2: string | null; landmark: string | null;
  city: string; state: string; postal_code: string; latitude: number; longitude: number; is_default: boolean;
}

export function toSavedAddress(row: AddressRow): SavedAddress {
  return {
    id: row.id, label: row.label, receiverName: row.recipient_name, receiverPhone: row.phone, line1: row.address_line_1, line2: row.address_line_2,
    landmark: row.landmark, city: row.city, state: row.state, pincode: row.postal_code, lat: row.latitude, lng: row.longitude, isDefault: row.is_default,
  };
}

export const addressOneLine = (a: Pick<SavedAddress, 'line1' | 'line2' | 'landmark' | 'city' | 'pincode'>): string =>
  [a.line1, a.line2, a.landmark ? `Near ${a.landmark}` : null, `${a.city} ${a.pincode}`.trim()].filter(Boolean).join(', ');
