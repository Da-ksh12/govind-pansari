import { useEffect, useState } from 'react';
import { riderLocationService, type RiderLocationStatus } from '../services/location/riderLocationService';

/** The rider app's own view of location sharing, re-rendered every few seconds so "sent 12 s ago" keeps counting. */
export function useRiderLocationStatus(): { status: RiderLocationStatus; now: number } {
  const [status, setStatus] = useState<RiderLocationStatus>(riderLocationService.getStatus());
  const [now, setNow] = useState(Date.now());
  useEffect(() => riderLocationService.subscribeStatus(setStatus), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  return { status, now };
}
