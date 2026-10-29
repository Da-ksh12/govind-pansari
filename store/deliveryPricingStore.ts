import { create } from 'zustand';
import { supabase } from '../services/supabase/client';
import { parseDeliveryPricing, type DeliveryPricing } from '../services/deliveryPricing';

interface DeliveryPricingState {
  /** The server's delivery pricing for the customer's chosen place; null until known (the cart then uses FALLBACK_PRICING). */
  pricing: DeliveryPricing | null;
  /**
   * Asks the server for the pricing at a place. A failed REQUEST (offline, server error) keeps whatever was known. A real answer replaces it —
   * including "nothing serves this place", which clears it so the cart never shows another place's fee.
   */
  refresh: (position: { lat: number; lng: number }) => Promise<void>;
  clear: () => void;
}

export const useDeliveryPricingStore = create<DeliveryPricingState>()((set) => ({
  pricing: null,
  refresh: async ({ lat, lng }) => {
    try {
      const { data, error } = await supabase.rpc('get_delivery_pricing', { p_lat: lat, p_lng: lng });
      if (error) return;
      set({ pricing: parseDeliveryPricing(data) });
    } catch {
      // offline: keep what was known
    }
  },
  clear: () => set({ pricing: null }),
}));
