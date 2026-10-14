import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { useAsync } from '../../hooks/useAsync';
import { userRepository } from '../../services/repositories/userRepository';
import { useAuthStore } from '../../store/authStore';
import { useUIStore } from '../../store/uiStore';
import { formatPhoneDisplay } from '../../services/phone';

export default function PersonalInfoScreen() {
  const { data: profile } = useAsync(() => userRepository.getProfile(), []);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const showToast = useUIStore((s) => s.showToast);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setEmail(profile.email ?? '');
    }
  }, [profile]);

  const dirty = profile && (name !== profile.name || email !== (profile.email ?? ''));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await userRepository.updateProfile({ fullName: name.trim(), email: email.trim() || undefined });
      await refreshProfile();
      setSaved(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save your changes. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!profile) return <SafeScreen />;

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>Personal Information</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.field}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={(t) => { setName(t); setSaved(false); }} selectionColor={colors.primary} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Mobile Number</Text>
            <TextInput style={[styles.input, styles.inputDisabled]} value={formatPhoneDisplay(profile.phone)} editable={false} />
            <Text style={styles.hint}>Your mobile number is your sign-in identity and can't be edited here.</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(t) => { setEmail(t); setSaved(false); }}
              keyboardType="email-address"
              autoCapitalize="none"
              selectionColor={colors.primary}
            />
          </View>

          <Pressable style={[styles.saveBtn, { opacity: dirty && !saving ? 1 : 0.5 }]} onPress={handleSave} disabled={!dirty || saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveBtnText}>Save Changes</Text>}
          </Pressable>
          {saved && <Text style={styles.savedText}>Saved.</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19, color: colors.textPrimary },
  content: { paddingHorizontal: spacing.base, gap: spacing.lg, paddingBottom: spacing.xxl },
  field: { gap: spacing.xs },
  label: { ...textStyles.caption, color: colors.textSecondary },
  hint: { ...textStyles.caption, color: colors.textMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.base,
    height: 48,
    ...textStyles.body,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputDisabled: { color: colors.textMuted, backgroundColor: colors.surfaceSunken },
  saveBtn: {
    marginTop: spacing.md,
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { ...textStyles.button, color: colors.white, fontSize: 16 },
  savedText: { ...textStyles.bodySmall, color: colors.success, textAlign: 'center' },
});
