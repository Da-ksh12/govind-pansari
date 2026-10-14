import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
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
}

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
    const { data, error } = await supabase
      .from('addresses')
      .insert({
        user_id: user.id,
        label: input.label,
        recipient_name: input.receiverName,
        phone: input.receiverPhone,
        address_line_1: input.line1,
        address_line_2: input.line2 ?? null,
        landmark: input.landmark ?? null,
        city: input.city,
        state: input.state,
        postal_code: input.pincode,
        latitude: input.lat,
        longitude: input.lng,
      })
      .select('*')
      .single();
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

    const { data, error } = await supabase.from('addresses').update(patch).eq('id', id).select('*').single();
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
