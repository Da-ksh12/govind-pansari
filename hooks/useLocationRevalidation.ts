import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useLocationStore } from '../store/locationStore';
import { storeRepository } from '../services/repositories/storeRepository';

/**
 * Keeps the delivery status shown on Home honest. The selected location is stored on the device across launches, but
 * whether it is deliverable changes (opening hours, a paused store, the delivery radius) — so a stored "serviceable" is
 * never trusted: it is asked of the server again when Home opens, when the selected point changes, and whenever the app
 * comes back to the foreground. If the check cannot be made (offline) the last known answer stays — it is replaced
 * only by a real answer.
 */
export function useLocationRevalidation() {
  const lat = useLocationStore((s) => s.selected?.position.lat);
  const lng = useLocationStore((s) => s.selected?.position.lng);

  const revalidate = useCallback(async () => {
    const current = useLocationStore.getState().selected;
    if (!current) return;
    try {
      const result = await storeRepository.checkServiceability(current.position);
      // The customer may have picked another location while this was in flight.
      const now = useLocationStore.getState().selected;
      if (now && now.position.lat === current.position.lat && now.position.lng === current.position.lng) {
        useLocationStore.getState().setLocation(now, result);
      }
    } catch {
      // Keep the previous answer.
    }
  }, []);

  useEffect(() => {
    revalidate();
  }, [lat, lng, revalidate]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') revalidate();
    });
    return () => subscription.remove();
  }, [revalidate]);
}
