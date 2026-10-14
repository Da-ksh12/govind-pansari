import { supabase } from '../supabase/client';
import { toCatalogueError } from '../supabase/errors';
import { toOffer } from '../supabase/mappers';
import type { Offer } from '../../types/models';
import type { OfferRow } from '../../types/supabase';

export const offerRepository = {
  async list(): Promise<Offer[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('offers')
      .select('*')
      .eq('is_active', true)
      .lte('start_at', nowIso)
      .or(`end_at.is.null,end_at.gte.${nowIso}`)
      .order('sort_order');
    if (error) throw toCatalogueError(error);
    return (data as OfferRow[]).map(toOffer);
  },
};
