import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { Bike } from 'lucide-react-native';
import { colors, radius, shadows } from '../../theme';
import { ICON_STROKE } from '../../theme/icons';
import { osmMapStyle } from '../../services/map/osmStyle';
import type { FleetMapProps } from './FleetMap.types';

function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 5 * 60_000;
}

/** Real MapLibre rendering — iOS/Android only (see FleetMap.web.tsx for the web fallback, same split as LiveTrackingMap). */
export function FleetMap({ riders, selectedId, onSelectRider }: FleetMapProps) {
  const cameraRef = useRef<CameraRef>(null);

  useEffect(() => {
    if (riders.length === 0 || !cameraRef.current) return;
    const lats = riders.map((r) => r.current_latitude);
    const lngs = riders.map((r) => r.current_longitude);
    cameraRef.current.fitBounds(
      [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
      { padding: { top: 60, left: 60, right: 60, bottom: 60 }, duration: 400 },
    );
  }, [riders]);

  const first = riders[0];

  return (
    <Map mapStyle={osmMapStyle} style={styles.map} logo={false} attribution={false} compass={false}>
      <Camera ref={cameraRef} initialViewState={{ center: first ? [first.current_longitude, first.current_latitude] : [78.0081, 27.1767], zoom: 12 }} />
      {riders.map((r) => {
        const fresh = isFresh(r.last_location_at);
        const active = r.rider_id === selectedId;
        return (
          <Marker
            key={r.rider_id}
            lngLat={[r.current_longitude, r.current_latitude]}
            anchor="center"
            onPress={() => onSelectRider(r.rider_id)}
          >
            <View style={[styles.badge, !r.is_available && styles.badgeOffline, !fresh && styles.badgeStale, active && styles.badgeActive]}>
              <Bike size={16} color={colors.white} strokeWidth={ICON_STROKE} />
            </View>
          </Marker>
        );
      })}
    </Map>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  badge: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.success,
    borderWidth: 3, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.md,
  },
  badgeOffline: { backgroundColor: colors.textMuted },
  badgeStale: { opacity: 0.55 },
  badgeActive: { borderColor: colors.primary, transform: [{ scale: 1.15 }] },
});
