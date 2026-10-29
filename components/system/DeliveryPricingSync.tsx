import { useCallback, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useLocationStore } from '../../store/locationStore';
import { useDeliveryPricingStore } from '../../store/deliveryPricingStore';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';

/**
 * Keeps the cart's delivery fee and free-delivery level equal to what the server charges for the customer's chosen place: loaded when the place
 * changes, when a customer signs in, and whenever the app returns to the foreground (so an admin's change to a zone's fee reaches the cart).
 * Renders nothing.
 */
export function DeliveryPricingSync() {
  const position = useLocationStore((s) => s.selected?.position);
  const signedIn = useAuthStore((s) => s.status === 'authenticated');
  const refresh = useDeliveryPricingStore((s) => s.refresh);
  const lat = position?.lat;
  const lng = position?.lng;

  const load = useCallback(() => {
    if (signedIn && lat != null && lng != null) refresh({ lat, lng }).catch(() => {});
  }, [signedIn, lat, lng, refresh]);

  useEffect(() => {
    load();
  }, [load]);
  useRefetchOnForeground(load);

  // Signing out must not leave the last customer's place pricing behind for the next account on this phone.
  useEffect(() => {
    if (!signedIn) useDeliveryPricingStore.getState().clear();
  }, [signedIn]);

  return null;
}
