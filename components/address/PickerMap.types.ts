import type { LatLng } from '../../types/models';

export interface PickerMapProps {
  /** Where the map opens. Never saved by itself: the pin only counts once the customer has placed it. */
  initialCenter: LatLng;
  initialZoom?: number;
  /** Called when the map stops moving, with the position under the centre pin. */
  onCenterSettled: (position: LatLng) => void;
  /** Called while the map is being dragged or animating (so the UI can mark the address as "updating"). */
  onMoveStart?: () => void;
  /** Called when the customer taps the map; the pin then moves there. */
  onTap?: (position: LatLng) => void;
  /** Height of the panel overlapping the bottom of the map, so provider logos/attribution stay visible above it. */
  bottomInset: number;
}

export interface PickerMapRef {
  /** Moves the map (and so the pin) to a position. */
  flyTo: (position: LatLng, zoom?: number) => void;
}
