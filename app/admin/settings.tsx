import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { AdminShell } from '../../components/admin/AdminShell';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository } from '../../services/repositories/adminRepository';

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

  const saveField = async (key: string, apiKey: string, value: string, numeric = false) => {
    let payloadValue: string | number = value;
    if (numeric) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        showToast('Please enter a valid, non-negative number.', 'error');
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
          <Field label="Default Minimum Order Value (₹)" value={String(field('default_min_order_value'))} onChangeText={(v) => setDraft((d) => ({ ...d, default_min_order_value: v }))} onBlur={() => saveField('default_min_order_value', 'defaultMinOrderValue', field('default_min_order_value'), true)} editable={canManage} keyboardType="numeric" />
          <Field label="Default Delivery Fee (₹)" value={String(field('default_delivery_fee'))} onChangeText={(v) => setDraft((d) => ({ ...d, default_delivery_fee: v }))} onBlur={() => saveField('default_delivery_fee', 'defaultDeliveryFee', field('default_delivery_fee'), true)} editable={canManage} keyboardType="numeric" />
          <Field label="Default Low-Stock Threshold" value={String(field('default_low_stock_threshold'))} onChangeText={(v) => setDraft((d) => ({ ...d, default_low_stock_threshold: v }))} onBlur={() => saveField('default_low_stock_threshold', 'defaultLowStockThreshold', field('default_low_stock_threshold'), true)} editable={canManage} keyboardType="numeric" />
          <Text style={styles.hint}>These are seed defaults only — per-store hours, per-zone serviceability, and per-rider capacity are managed on their own screens and are never overridden by this value.</Text>
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
