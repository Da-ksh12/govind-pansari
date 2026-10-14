import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Realtime sockets suspend when the app backgrounds (mobile) or a web
 * tab loses focus long enough — resubscribing on reconnect does not
 * backfill whatever changed while disconnected (Postgres Changes is a
 * live stream, not a replayable queue). Re-running the screen's own
 * authoritative fetch on foreground closes that gap without a second
 * data source — the same pattern app/track/[orderId].tsx already used,
 * generalized here (pre-production hardening, priority 8).
 */
export function useRefetchOnForeground(refetch: () => void) {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => sub.remove();
  }, [refetch]);
}
