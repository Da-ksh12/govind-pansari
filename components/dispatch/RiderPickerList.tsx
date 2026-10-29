import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { Avatar } from '../ui/Avatar';
import type { AssignableRider } from '../../services/repositories/storeOpsRepository';
import { describeRiderStatus, formatRiderDistance, riderBlockedReason, type RiderStatusTone } from '../../services/riderAssignment';

interface Props {
  riders: AssignableRider[];
  loading: boolean;
  /** A load failure — shown with a retry instead of an empty list. */
  error?: string | null;
  onRetry?: () => void;
  /** The rider whose assignment is being saved right now. */
  busyRiderId?: string | null;
  onPick: (rider: AssignableRider) => void;
}

const TONE: Record<RiderStatusTone, { fg: string; bg: string }> = {
  good: { fg: colors.success, bg: colors.successTint },
  busy: { fg: colors.warning, bg: colors.warningTint },
  muted: { fg: colors.textMuted, bg: colors.surfaceSunken },
};

/**
 * The manual "choose a rider" list. Riders are only ever assigned by a person picking one here (there is no
 * automatic assignment), so the list shows what that person needs to choose well: whether each rider is free,
 * already delivering or offline, how many deliveries they carry, and how far they are from the store. Riders who
 * cannot take this order are listed after the others, greyed out, with the reason.
 */
export function RiderPickerList({ riders, loading, error, onRetry, busyRiderId, onPick }: Props) {
  if (loading) return <ActivityIndicator style={styles.loader} color={colors.primary} />;
  if (error) {
    return (
      <View style={styles.stateBox}>
        <Text style={styles.errorText}>{error}</Text>
        {onRetry && (
          <Pressable onPress={onRetry} hitSlop={8}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        )}
      </View>
    );
  }
  if (riders.length === 0) {
    return (
      <View style={styles.stateBox}>
        <Text style={styles.emptyTitle}>No riders found</Text>
        <Text style={styles.emptyHint}>No active riders are set up yet. Add a rider from the admin app.</Text>
      </View>
    );
  }

  const available = riders.filter((r) => r.canAssign);
  const unavailable = riders.filter((r) => !r.canAssign);
  const anyBusy = !!busyRiderId;

  const renderRow = (r: AssignableRider) => {
    const status = describeRiderStatus(r.status);
    const tone = TONE[status.tone];
    const blocked = riderBlockedReason(r);
    const meta = [r.vehicleType, r.vehicleNumber, r.sameStore ? 'This store' : 'Other store'].filter(Boolean).join(' • ');
    return (
      <Pressable
        key={r.riderId}
        style={[styles.row, !!blocked && styles.rowBlocked, anyBusy && busyRiderId !== r.riderId && styles.rowDimmed]}
        onPress={() => onPick(r)}
        disabled={!!blocked || anyBusy}
        accessibilityRole="button"
        accessibilityLabel={`${r.name}, ${status.label}${blocked ? `, ${blocked}` : ''}`}
      >
        <Avatar uri={r.avatarUrl} name={r.name} size="md" />
        <View style={styles.rowBody}>
          <View style={styles.nameLine}>
            <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
            <View style={[styles.chip, { backgroundColor: tone.bg }]}>
              <View style={[styles.chipDot, { backgroundColor: tone.fg }]} />
              <Text style={[styles.chipText, { color: tone.fg }]}>{status.label}</Text>
            </View>
          </View>
          <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {r.activeDeliveries}/{r.capacity} {r.capacity === 1 ? 'delivery' : 'deliveries'} • {formatRiderDistance(r.distanceMeters, r.locationAgeSeconds)}
          </Text>
          {blocked && <Text style={styles.blocked}>{blocked}</Text>}
        </View>
        {busyRiderId === r.riderId && <ActivityIndicator size="small" color={colors.primary} />}
      </Pressable>
    );
  };

  return (
    <View style={styles.list}>
      {available.length > 0 ? (
        <>
          <Text style={styles.groupLabel}>Can take this order ({available.length})</Text>
          {available.map(renderRow)}
        </>
      ) : (
        <View style={styles.stateBox}>
          <Text style={styles.emptyTitle}>Nobody can take this order right now</Text>
          <Text style={styles.emptyHint}>Every rider is offline or at their delivery limit. Try again in a moment, or ask a rider to go online.</Text>
        </View>
      )}
      {unavailable.length > 0 && (
        <>
          <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>Not available right now ({unavailable.length})</Text>
          {unavailable.map(renderRow)}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  loader: { marginVertical: spacing.xl },
  groupLabel: { ...textStyles.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  groupLabelSpaced: { marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowBlocked: { backgroundColor: colors.surfaceMuted, opacity: 0.65 },
  rowDimmed: { opacity: 0.5 },
  rowBody: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  name: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, flexShrink: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { ...textStyles.caption, fontFamily: 'PlusJakartaSans_700Bold' },
  meta: { ...textStyles.caption, color: colors.textSecondary },
  blocked: { ...textStyles.caption, color: colors.error },
  stateBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  errorText: { ...textStyles.bodySmall, color: colors.error, textAlign: 'center' },
  emptyTitle: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold', textAlign: 'center' },
  emptyHint: { ...textStyles.caption, color: colors.textSecondary, textAlign: 'center' },
  link: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
});
