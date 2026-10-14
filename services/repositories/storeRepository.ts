import { supabase } from '../supabase/client';
import { toCatalogueError, CatalogueError } from '../supabase/errors';
import { toStore } from '../supabase/mappers';
import type { Store, LatLng } from '../../types/models';
import type { StoreRow } from '../../types/supabase';

export interface EligibleStore {
  storeId: string;
  storeName: string;
  distanceMeters: number;
}

export type ServiceabilityResult =
  | {
      serviceable: true;
      zoneId: string;
      deliveryFee: number;
      minimumOrderValue: number;
      estimatedDeliveryMinutes: number;
      eligibleStores: EligibleStore[];
    }
  | { serviceable: false; reason: 'OUTSIDE_SERVICE_AREA' };

async function getStoreById(id: string): Promise<Store | undefined> {
  const { data, error } = await supabase.from('stores').select('*').eq('id', id).maybeSingle();
  if (error) throw toCatalogueError(error);
  return data ? toStore(data as StoreRow) : undefined;
}

export const storeRepository = {
  async list(): Promise<Store[]> {
    const { data, error } = await supabase.from('stores').select('*').eq('is_active', true);
    if (error) throw toCatalogueError(error);
    return (data as StoreRow[]).map(toStore);
  },

  getById: getStoreById,

  /**
   * Serviceability lookup: delivery-zone geofencing + priority/distance
   * ranking, via the find_serviceable_stores() function from the Phase
   * 01 schema (read-only, already tested against the live project) —
   * not a naive straight-line nearest-store guess.
   */
  async findNearest(lat: number, lng: number): Promise<Store> {
    const { data, error } = await supabase.rpc('find_serviceable_stores', { customer_lat: lat, customer_lng: lng });
    if (error) throw toCatalogueError(error);
    if (!data || data.length === 0) {
      throw new CatalogueError('STORE_NOT_FOUND', 'No store currently serves this location');
    }
    const nearest = await getStoreById(data[0].store_id);
    if (!nearest) throw new CatalogueError('STORE_NOT_FOUND', 'This store is no longer available');
    return nearest;
  },

  /**
   * The authoritative serviceability check (section 21-23) — always a
   * fresh server call, never a client-side re-use of a previous
   * result. Client-provided coordinates are untrusted input; this is
   * what re-derives serviceability from them server-side every time
   * it matters (e.g. right before checkout in a later phase).
   */
  async checkServiceability(position: LatLng): Promise<ServiceabilityResult> {
    const { data, error } = await supabase.rpc('check_serviceability', { p_lat: position.lat, p_lng: position.lng });
    if (error) throw toCatalogueError(error);
    return data as ServiceabilityResult;
  },
};
