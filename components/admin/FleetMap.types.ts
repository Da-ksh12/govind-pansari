import type { AdminRiderLocation } from '../../services/repositories/adminRepository';

/** Kept dependency-free (no @maplibre import) so FleetMap.web.tsx never pulls in the native-only map package — same reasoning as LiveTrackingMap.types.ts. */
export interface FleetMapProps {
  riders: AdminRiderLocation[];
  selectedId: string | null;
  onSelectRider: (riderId: string) => void;
}
