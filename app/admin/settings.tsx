import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { AdminShell } from '../../components/admin/AdminShell';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository } from '../../services/repositories/adminRepository';
import { pushAdmin } from '../../services/adminNav';

export default function AdminSettingsScreen() {
  const [settings, setSettings] = useState<any | null>(null);
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);
  const canManage = hasPermission('settings.manage');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([adminRepository.getSettings(), adminRepository.getFeatureFlags()])
      .then(([s, f]) => { setSettings(s); setFlags(f); })
      .catch(() => { setSettings(null); setFlags([]); })
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const field = (key: string) => draft[key] ?? settings?.[key] ?? '';

  const saveField = async (key: string, apiKey: string, value: string, numeric = false, range?: { min: number; max: number; label: string }) => {
    let payloadValue: string | number = value;
    if (numeric) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || (range && (n < range.min || n > range.max))) {
        showToast(range ? `${range.label} must be between ${range.min} and ${range.max}.` : 'Please enter a valid, non-negative number.', 'error');
        setDraft((d) => { const next = { ...d }; delete next[key]; return next; });
        return;
      }
      payloadValue = n;
    }
    setSaving(true);
    try {
      await adminRepository.updateSettings({ [apiKey]: payloadValue });
      showToast('Settings updated.', 'success');
      load();
    } catch {
      showToast('Unable to update settings. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleFlag = async (flag: any) => {
    const next = !flag.enabled;
    setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: next } : f)));
    try {
      await adminRepository.setFeatureFlag(flag.key, next);
    } catch {
      setFlags((prev) => prev.map((f) => (f.key === flag.key ? { ...f, enabled: !next } : f)));
      showToast("Couldn't update this feature flag.", 'error');
    }
  };

  if (loading || !settings) {
    return (
      <AdminShell title="Settings">
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Settings" subtitle="Business defaults and feature configuration">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Business Details</Text>
          <Field label="Business Name" value={field('business_name')} onChangeText={(v) => setDraft((d) => ({ ...d, business_name: v }))} onBlur={() => saveField('business_name', 'businessName', field('business_name'))} editable={canManage} />
          <Field label="Support Phone" value={field('support_phone')} onChangeText={(v) => setDraft((d) => ({ ...d, support_phone: v }))} onBlur={() => saveField('support_phone', 'supportPhone', field('support_phone'))} editable={canManage} />
          <Field label="Support Email" value={field('support_email')} onChangeText={(v) => setDraft((d) => ({ ...d, support_email: v }))} onBlur={() => saveField('support_email', 'supportEmail', field('support_email'))} editable={canManage} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Order & Inventory Defaults</Text>
          {/* The delivery fee and the minimum order are NOT set here: customers are charged the delivery zone's own numbers, and the two
              "default" fields that used to be here were read by nothing — an admin could change them and no price moved. They live under
              Delivery & Pricing now. */}
          <Pressable style={styles.pricingLink} onPress={() => pushAdmin('/admin/pricing')} accessibilityRole="button">
            <Text style={styles.pricingLinkText}>Delivery fee, minimum order and free-delivery level are set per delivery area →</Text>
          </Pressable>
          <Field label="Default Low-Stock Threshold" value={String(field('default_low_stock_threshold'))} onChangeText={(v) => setDraft((d) => ({ ...d, default_low_stock_threshold: v }))} onBlur={() => saveField('default_low_stock_threshold', 'defaultLowStockThreshold', field('default_low_stock_threshold'), true)} editable={canManage} keyboardType="numeric" />
          <Text style={styles.hint}>These are seed defaults only — per-store hours, per-zone serviceability, and per-rider capacity are managed on their own screens and are never overridden by this value.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delivery Area</Text>
          <Field
            label="Maximum delivery distance (km)"
            value={String(field('max_delivery_radius_km'))}
            onChangeText={(v) => setDraft((d) => ({ ...d, max_delivery_radius_km: v }))}
            onBlur={() => saveField('max_delivery_radius_km', 'maxDeliveryRadiusKm', field('max_delivery_radius_km'), true, { min: 1, max: 50, label: 'The delivery distance' })}
            editable={canManage}
            keyboardType="numeric"
          />
          <Text style={styles.hint}>
            A store serves customers up to this straight-line distance away. One value for every store; the customer app, checkout and order creation all use it. The nearest store that is open, accepting orders and holds the whole cart is chosen.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Feature Flags</Text>
          {flags.map((flag) => (
            <View key={flag.key} style={styles.flagRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.flagKey}>{flag.key.replace(/_/g, ' ')}</Text>
                {flag.description && <Text style={styles.flagDesc}>{flag.description}</Text>}
              </View>
              <Switch value={flag.enabled} onValueChange={() => toggleFlag(flag)} disabled={!canManage} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
            </View>
          ))}
        </View>
      </ScrollView>
    </AdminShell>
  );
}

function Field({ label, value, onChangeText, onBlur, editable, keyboardType }: { label: string; value: string; onChangeText: (v: string) => void; onBlur: () => void; editable: boolean; keyboardType?: 'numeric' }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.fieldInput} value={value} onChangeText={onChangeText} onBlur={onBlur} editable={editable} keyboardType={keyboardType} placeholderTextColor={colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  pricingLink: { paddingVertical: spacing.sm },
  pricingLinkText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold', lineHeight: 17 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, maxWidth: 640, width: '100%', alignSelf: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, marginBottom: spacing.sm },
  fieldWrap: { marginBottom: spacing.sm },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, marginBottom: 4 },
  fieldInput: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 42, ...textStyles.bodySmall, color: colors.textPrimary },
  hint: { ...textStyles.caption, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 16 },
  flagRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  flagKey: { ...textStyles.bodySmall, color: colors.textPrimary, textTransform: 'capitalize' },
  flagDesc: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
});
