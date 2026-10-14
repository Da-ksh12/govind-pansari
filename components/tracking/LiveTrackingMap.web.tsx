import React, { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MapPinned } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { formatEta } from '../../hooks/useLiveRoute';
import type { LiveTrackingMapProps, LiveTrackingMapRef } from './LiveTrackingMap.types';

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * MapLibre React Native has no web build at all (confirmed: no .web.*
 * files anywhere in the package, no web platform declared) — it calls
 * native map SDKs directly, which don't exist in a browser. Rather
 * than risk an untested runtime crash (this environment has no
 * browser to verify against — see docs/web-platform.md), the map is
 * platform-split at the file level (Metro's own `.native.tsx`/
 * `.web.tsx` resolution) so the real native module is never even
 * imported on web. This is the honest, real state on web today — the
 * live position/ETA data underneath is exactly the same real data the
 * native map renders, just not plotted on a map here yet.
 */
export const LiveTrackingMap = forwardRef<LiveTrackingMapRef, LiveTrackingMapProps>(function LiveTrackingMap(
  { riderPos, route, stale },
  ref,
) {
  useImperativeHandle(ref, () => ({ fitBounds: () => {} }));

  return (
    <View style={styles.fallback}>
      <View style={styles.iconCircle}>
        <MapPinned size={ICON_SIZE.xl} color={colors.primary} strokeWidth={ICON_STROKE} />
      </View>
      <Text style={styles.title}>Live map view</Text>
      <Text style={styles.subtitle}>The interactive live map is available in the Govind Pansari mobile app.</Text>
      {riderPos && !stale && (
        <View style={styles.statusPill}>
          <View style={styles.liveDot} />
          <Text style={styles.statusText}>
            Rider is on the way{route ? ` — ${formatDistance(route.distanceMeters)}, ${formatEta(route.durationSeconds)}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, padding: spacing.xl },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  subtitle: { ...textStyles.bodySmall, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, maxWidth: 280 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.base, paddingVertical: spacing.sm, marginTop: spacing.lg },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  statusText: { ...textStyles.caption, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
});
