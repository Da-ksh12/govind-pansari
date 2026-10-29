import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { createStructuredColumnMemory, isMissingColumnError, withoutStructuredColumns } from '../addressPersistence';
import type { Address } from '../../types/models';

interface AddressRow {
  id: string;
  label: 'home' | 'work' | 'other';
  recipient_name: string;
  phone: string;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  state: string;
  postal_code: string;
  latitude: number;
  longitude: number;
  is_default: boolean;
  landmark: string | null;
  house_no: string | null;
  building: string | null;
  floor: string | null;
  street: string | null;
  locality: string | null;
  formatted_address: string | null;
  place_id: string | null;
  delivery_instructions: string | null;
  geocode_source: 'google' | 'osm' | 'device' | 'manual' | null;
}

function toAddress(row: AddressRow): Address {
  return {
    id: row.id,
    label: row.label,
    line1: row.address_line_1,
    line2: row.address_line_2 ?? undefined,
    city: row.city,
    state: row.state,
    pincode: row.postal_code,
    lat: row.latitude,
    lng: row.longitude,
    isDefault: row.is_default,
    receiverName: row.recipient_name,
    receiverPhone: row.phone,
    houseNo: row.house_no ?? undefined,
    building: row.building ?? undefined,
    floor: row.floor ?? undefined,
    street: row.street ?? undefined,
    locality: row.locality ?? undefined,
    landmark: row.landmark ?? undefined,
    formattedAddress: row.formatted_address ?? undefined,
    placeId: row.place_id ?? undefined,
    deliveryInstructions: row.delivery_instructions ?? undefined,
    geocodeSource: row.geocode_source ?? undefined,
  };
}

export interface AddressInput {
  label: 'home' | 'work' | 'other';
  receiverName: string;
  receiverPhone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  lat: number;
  lng: number;
  houseNo?: string;
  building?: string;
  floor?: string;
  street?: string;
  locality?: string;
  formattedAddress?: string;
  placeId?: string;
  deliveryInstructions?: string;
  geocodeSource?: 'google' | 'osm' | 'device' | 'manual';
}

/** Empty strings are stored as NULL: a blank field means "not provided", not an empty value. */
const orNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** Whether this database has the structured-address columns (see addressPersistence.ts); re-checked every few minutes. */
const structuredColumns = createStructuredColumnMemory();

export const addressRepository = {
  async list(): Promise<Address[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', user.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw toCatalogueError(error);
    return (data as AddressRow[]).map(toAddress);
  },

  async getDefault(): Promise<Address | undefined> {
    const list = await this.list();
    return list.find((a) => a.isDefault) ?? list[0];
  },

  async create(input: AddressInput): Promise<Address> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Must be signed in to save an address');

    // RLS restricts writes to the caller's own user_id regardless, but
    // setting it explicitly keeps the insert self-describing.
    const row: Record<string, unknown> = {
      user_id: user.id,
      label: input.label,
      recipient_name: input.receiverName,
      phone: input.receiverPhone,
      address_line_1: input.line1,
      address_line_2: input.line2 ?? null,
      landmark: orNull(input.landmark),
      city: input.city,
      state: input.state,
      postal_code: input.pincode,
      latitude: input.lat,
      longitude: input.lng,
      house_no: orNull(input.houseNo),
      building: orNull(input.building),
      floor: orNull(input.floor),
      street: orNull(input.street),
      locality: orNull(input.locality),
      formatted_address: orNull(input.formattedAddress),
      place_id: orNull(input.placeId),
      delivery_instructions: orNull(input.deliveryInstructions),
      geocode_source: input.geocodeSource ?? null,
    };

    // A database that has not had the structured-address migration yet refuses the new columns (PGRST204) — that must never stop
    // a customer saving their address. See services/addressPersistence.ts.
    if (structuredColumns.shouldTryStructured()) {
      const attempt = await supabase.from('addresses').insert(row).select('*').single();
      if (!attempt.error) return toAddress(attempt.data as AddressRow);
      if (!isMissingColumnError(attempt.error)) throw toCatalogueError(attempt.error);
      structuredColumns.markMissing();
    }
    const { data, error } = await supabase.from('addresses').insert(withoutStructuredColumns(row)).select('*').single();
    if (error) throw toCatalogueError(error);
    return toAddress(data as AddressRow);
  },

  async update(id: string, input: Partial<AddressInput>): Promise<Address> {
    const patch: Record<string, unknown> = {};
    if (input.label !== undefined) patch.label = input.label;
    if (input.receiverName !== undefined) patch.recipient_name = input.receiverName;
    if (input.receiverPhone !== undefined) patch.phone = input.receiverPhone;
    if (input.line1 !== undefined) patch.address_line_1 = input.line1;
    if (input.line2 !== undefined) patch.address_line_2 = input.line2;
    if (input.landmark !== undefined) patch.landmark = input.landmark;
    if (input.city !== undefined) patch.city = input.city;
    if (input.state !== undefined) patch.state = input.state;
    if (input.pincode !== undefined) patch.postal_code = input.pincode;
    if (input.lat !== undefined) patch.latitude = input.lat;
    if (input.lng !== undefined) patch.longitude = input.lng;
    if (input.houseNo !== undefined) patch.house_no = orNull(input.houseNo);
    if (input.building !== undefined) patch.building = orNull(input.building);
    if (input.floor !== undefined) patch.floor = orNull(input.floor);
    if (input.street !== undefined) patch.street = orNull(input.street);
    if (input.locality !== undefined) patch.locality = orNull(input.locality);
    if (input.formattedAddress !== undefined) patch.formatted_address = orNull(input.formattedAddress);
    if (input.placeId !== undefined) patch.place_id = orNull(input.placeId);
    if (input.deliveryInstructions !== undefined) patch.delivery_instructions = orNull(input.deliveryInstructions);
    if (input.geocodeSource !== undefined) patch.geocode_source = input.geocodeSource;

    if (structuredColumns.shouldTryStructured()) {
      const attempt = await supabase.from('addresses').update(patch).eq('id', id).select('*').single();
      if (!attempt.error) return toAddress(attempt.data as AddressRow);
      if (!isMissingColumnError(attempt.error)) throw toCatalogueError(attempt.error);
      structuredColumns.markMissing();
    }
    const legacyPatch = withoutStructuredColumns(patch);
    if (Object.keys(legacyPatch).length === 0) {
      // Nothing but structured fields were being changed and this database cannot store them: leave the address as it is.
      const { data, error } = await supabase.from('addresses').select('*').eq('id', id).single();
      if (error) throw toCatalogueError(error);
      return toAddress(data as AddressRow);
    }
    const { data, error } = await supabase.from('addresses').update(legacyPatch).eq('id', id).select('*').single();
    if (error) throw toCatalogueError(error);
    return toAddress(data as AddressRow);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('addresses').delete().eq('id', id);
    if (error) throw toCatalogueError(error);
  },

  /** Atomic default swap via the set_default_address() function — never two separate client updates. */
  async setDefault(id: string): Promise<void> {
    const { error } = await supabase.rpc('set_default_address', { p_address_id: id });
    if (error) throw toCatalogueError(error);
  },
};
