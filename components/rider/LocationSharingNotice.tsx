import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Radio } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { formatAge } from '../../services/riderFreshness';
import type { RiderLocationStatus } from '../../services/location/riderLocationService';

interface Props {
  sharing: boolean;
  lastSentAt: number | null;
  accuracy: number | null;
  rejected: RiderLocationStatus['lastRejected'];
  now: number;
  onRetry: () => void;
}

/**
 * Tells the rider the truth about location sharing: it is real GPS, it only runs while the app is open, and what the
 * customer is currently seeing. Sharing is foreground-only — see riderLocationService.
 */
export function LocationSharingNotice({ sharing, lastSentAt, accuracy, rejected, now, onRetry }: Props) {
  if (!sharing) {
    return (
      <View style={[styles.box, styles.warn]} accessibilityRole="alert">
        <AlertTriangle size={ICON_SIZE.sm} color={colors.warning} strokeWidth={ICON_STROKE} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Location sharing is off</Text>
          <Text style={styles.body}>The customer cannot see where you are. Allow location access for this app, then try again.</Text>
        </View>
        <Pressable onPress={onRetry} style={styles.retry} hitSlop={8}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const sent = lastSentAt != null ? formatAge(Math.max(0, Math.floor((now - lastSentAt) / 1000))).replace('Updated', 'Last sent') : 'Waiting for the first GPS reading…';
  const detail =
    rejected === 'inaccurate' ? 'GPS signal is weak — move to an open area.' : rejected === 'stale' ? 'Waiting for a fresh GPS reading…' : null;
  return (
    <View style={[styles.box, styles.ok]}>
      <Radio size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Sharing your live location</Text>
        <Text style={styles.body}>
          {sent}
          {accuracy != null ? ` · ±${Math.round(accuracy)} m` : ''}
          {detail ? `\n${detail}` : ''}
        </Text>
        <Text style={styles.hint}>Keep this app open — sharing pauses when the app is in the background and resumes when you come back.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  ok: { backgroundColor: colors.successTint },
  warn: { backgroundColor: colors.warningTint },
  title: { ...textStyles.bodySmall, fontFamily: 'PlusJakartaSans_700Bold', color: colors.textPrimary },
  body: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  hint: { ...textStyles.caption, color: colors.textMuted, marginTop: 4 },
  retry: { alignSelf: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.primary },
  retryText: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
});
