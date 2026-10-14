import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Tag, Truck } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { notificationRepository } from '../services/repositories/notificationRepository';

export default function NotificationPreferencesScreen() {
  const [promotionsEnabled, setPromotionsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    notificationRepository
      .getPromotionsEnabled()
      .then(setPromotionsEnabled)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (value: boolean) => {
    setPromotionsEnabled(value);
    setSaving(true);
    try {
      await notificationRepository.setPromotionsEnabled(value);
    } catch {
      setPromotionsEnabled(!value); // revert on failure
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>Notification Preferences</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Truck size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Order & Delivery Updates</Text>
              <Text style={styles.rowSubtitle}>Order confirmations, packing, rider assignment, live delivery status.</Text>
            </View>
            <View style={styles.alwaysOnPill}>
              <Text style={styles.alwaysOnText}>Always on</Text>
            </View>
          </View>
          <Text style={styles.disabledHint}>
            These are essential to using Govind Pansari and can't be turned off — same as receiving your order confirmation email from any store.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Tag size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Offers & Promotions</Text>
              <Text style={styles.rowSubtitle}>Festival specials, new arrivals, and limited-time discounts.</Text>
            </View>
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Switch
                value={promotionsEnabled}
                onValueChange={handleToggle}
                disabled={saving}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
              />
            )}
          </View>
        </View>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19, color: colors.textPrimary, flex: 1 },
  content: { paddingHorizontal: spacing.base, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, ...shadows.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  rowSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  alwaysOnPill: { backgroundColor: colors.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  alwaysOnText: { ...textStyles.caption, color: colors.textSecondary, fontSize: 10.5, fontFamily: 'PlusJakartaSans_700Bold' },
  disabledHint: { ...textStyles.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16 },
});
