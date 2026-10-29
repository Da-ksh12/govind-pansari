import { supabase } from '../supabase/client';
import { toCatalogueError, CatalogueError } from '../supabase/errors';
import { toStore } from '../supabase/mappers';
import type { Store, LatLng } from '../../types/models';
import type { StoreRow } from '../../types/supabase';
import { isValidCoordinate, type ServiceabilityResult } from '../serviceability';

// The result shape (and the wording for it) lives in ../serviceability so it can be unit-tested; re-exported for callers.
export type { EligibleStore, ServiceabilityResult, UnserviceableReason } from '../serviceability';

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
   * The nearest store that can serve this point right now, via the
   * server's find_serviceable_stores() — inside the delivery radius,
   * accepting orders and open, nearest first. The same eligibility
   * check_serviceability() and checkout use.
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
    // Bad input is an answer, not a network failure: no request is made for coordinates that cannot be a place.
    if (!isValidCoordinate(position.lat, position.lng)) return { serviceable: false, reason: 'INVALID_COORDINATES' };
    const { data, error } = await supabase.rpc('check_serviceability', { p_lat: position.lat, p_lng: position.lng });
    if (error) throw toCatalogueError(error);
    return data as ServiceabilityResult;
  },
};
