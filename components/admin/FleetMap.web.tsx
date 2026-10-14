import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bike, MapPinned } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import type { FleetMapProps } from './FleetMap.types';

function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 5 * 60_000;
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * MapLibre React Native has no web build (same reasoning as
 * LiveTrackingMap.web.tsx) — rather than add a second, unverified map
 * stack just for this one screen, this shows the exact same real
 * position/status data as a live, sortable list. Every coordinate and
 * timestamp here is real GPS data from `riders`, just not plotted on
 * tiles yet.
 */
export function FleetMap({ riders, selectedId, onSelectRider }: FleetMapProps) {
  if (riders.length === 0) {
    return (
      <View style={styles.empty}>
        <MapPinned size={ICON_SIZE.xl} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        <Text style={styles.emptyTitle}>No riders with a known position</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.notice}>
        <MapPinned size={ICON_SIZE.xs} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
        <Text style={styles.noticeText}>Pinned map view is available in the mobile app — showing the same live positions as a list here.</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {riders.map((r) => {
          const fresh = isFresh(r.last_location_at);
          const active = r.rider_id === selectedId;
          return (
            <Pressable key={r.rider_id} style={[styles.row, active && styles.rowActive]} onPress={() => onSelectRider(r.rider_id)}>
              <View style={[styles.dot, !r.is_available && styles.dotOffline, !fresh && styles.dotStale]}>
                <Bike size={14} color={colors.white} strokeWidth={ICON_STROKE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{r.full_name}</Text>
                <Text style={styles.meta}>
                  {r.vehicle_type} • {r.current_latitude.toFixed(4)}, {r.current_longitude.toFixed(4)} • updated {timeAgo(r.last_location_at)}
                </Text>
                {r.active_order_number && <Text style={styles.meta}>On order #{r.active_order_number} ({r.active_store_name})</Text>}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyTitle: { ...textStyles.bodySmall, color: colors.textSecondary },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceMuted, borderBottomWidth: 1, borderBottomColor: colors.divider },
  noticeText: { ...textStyles.caption, color: colors.textSecondary, flex: 1 },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowActive: { borderColor: colors.primary },
  dot: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  dotOffline: { backgroundColor: colors.textMuted },
  dotStale: { opacity: 0.55 },
  name: { ...textStyles.cardTitle, fontSize: 13.5, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
});
