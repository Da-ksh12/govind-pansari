import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bike, Phone } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SUPPORT_PHONE_NUMBER } from '../../data/contact';

interface LiveRiderCardProps {
  riderName: string;
  vehicleType: string | null;
  headline: string;
  etaLabel: string | null;
  distanceLabel: string | null;
  /** "Updated 12 s ago · ±20 m" — when the rider's phone last reported a position. Null before the first one. */
  locationNote?: string | null;
  /** The position is stale or only approximate: shown in the warning colour. */
  locationNoteWarn?: boolean;
}

/**
 * Real-data rider card for the live tracking screen. "Call Rider"
 * dials the shared default support number (data/contact.ts), not the
 * rider's own phone — the backend still never returns a rider's real
 * number to the customer (get_delivery_tracking, section 26/56), and
 * this app has no masked-calling/telephony integration to route a
 * direct call through safely (documented in docs/tracking-security.md).
 * A real, working button today, standing in for true rider calling
 * until that's built — not a fake one.
 */
export function LiveRiderCard({ riderName, vehicleType, headline, etaLabel, distanceLabel, locationNote, locationNoteWarn }: LiveRiderCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Bike size={22} color={colors.primary} strokeWidth={ICON_STROKE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.riderName} numberOfLines={1}>
            {riderName}
            {vehicleType ? ` • ${vehicleType}` : ''}
          </Text>
        </View>
        <Pressable style={styles.callBtn} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE_NUMBER}`).catch(() => {})} hitSlop={8}>
          <Phone size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
        </Pressable>
      </View>

      {!!locationNote && <Text style={[styles.locationNote, locationNoteWarn && { color: colors.warning }]}>{locationNote}</Text>}

      {(etaLabel || distanceLabel) && (
        <View style={styles.statsRow}>
          {distanceLabel && (
            <>
              <StatItem label="Distance away" value={distanceLabel} />
              {etaLabel && <View style={styles.statDivider} />}
            </>
          )}
          {etaLabel && <StatItem label="ETA" value={etaLabel} />}
        </View>
      )}
    </View>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.base, ...shadows.floating },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  headline: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  riderName: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  locationNote: { ...textStyles.caption, color: colors.textSecondary, marginTop: spacing.sm },
  statsRow: { flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  statDivider: { width: 1, backgroundColor: colors.divider },
  statValue: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  statLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1, fontSize: 10.5 },
});
