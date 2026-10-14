import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../theme';
import { Monogram } from '../components/brand/Wordmark';
import { AuthDesktopPanel } from '../components/auth/AuthDesktopPanel';
import { SafeScreen } from '../components/layout/SafeScreen';
import { useAuthStore } from '../store/authStore';
import { useLocationStore } from '../store/locationStore';
import { userRepository } from '../services/repositories/userRepository';
import { bannerImg } from '../data/images';

const WIDE_BREAKPOINT = 900;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One-time, post-signup profile setup — shown when profiles.full_name
 * is still empty (OTP signup never collects a name). Distinct from the
 * marketing intro carousel at app/onboarding.tsx.
 */
export default function WelcomeScreen() {
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const selectedLocation = useLocationStore((s) => s.selected);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const showEmail = !profile?.email;
  const canContinue = name.trim().length > 1 && (!showEmail || email.trim() === '' || EMAIL_RE.test(email.trim())) && !saving;

  const handleContinue = async () => {
    if (name.trim().length < 2) return;
    setError(null);
    setSaving(true);
    try {
      await userRepository.updateProfile({
        fullName: name.trim(),
        email: showEmail && email.trim() ? email.trim().toLowerCase() : undefined,
      });
      await refreshProfile();
      router.replace(selectedLocation ? '/(tabs)' : '/location');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your details. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const formContent = (
    <>
      {!isWide && <Monogram size={80} onDark={false} />}
      <Text style={[styles.title, isWide && styles.titleWide]}>Welcome to Govind Pansari</Text>
      <Text style={styles.subtitle}>Let's get your account set up — just your name to start.</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Full Name</Text>
        <TextInput
          style={[styles.input, error && styles.inputError]}
          placeholder="e.g. Priya Sharma"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={(t) => { setError(null); setName(t); }}
          autoFocus
          editable={!saving}
          returnKeyType={showEmail ? 'next' : 'done'}
        />
      </View>

      {showEmail && (
        <View style={styles.field}>
          <Text style={styles.label}>Email (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={setEmail}
            editable={!saving}
            returnKeyType="done"
          />
          <Text style={styles.hint}>For order receipts and account recovery.</Text>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Pressable style={[styles.cta, { opacity: canContinue ? 1 : 0.5 }]} onPress={handleContinue} disabled={!canContinue}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.ctaText}>Continue</Text>}
      </Pressable>
    </>
  );

  if (isWide) {
    return (
      <View style={styles.wideContainer}>
        <AuthDesktopPanel
          image={bannerImg('premium dry fruits assortment', 43)}
          eyebrow="Premium Dry Fruits & Spices"
          title={'Welcome\nHome'}
          subtitle="A trusted heritage since 1950 — quality you can taste, delivered fresh across Agra."
        />
        <View style={styles.wideFormSide}>
          <View style={styles.wideCard}>{formContent}</View>
        </View>
      </View>
    );
  }

  return (
    <SafeScreen>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>{formContent}</View>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.huge, alignItems: 'center' },
  wideContainer: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  wideFormSide: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  wideCard: {
    width: '100%', maxWidth: 400, alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl,
    borderWidth: 1, borderColor: colors.border,
  },
  titleWide: { marginTop: 0 },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary, marginTop: spacing.lg, textAlign: 'center' },
  subtitle: { ...textStyles.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xxl },
  field: { width: '100%', marginBottom: spacing.lg },
  label: { ...textStyles.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    width: '100%', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.surface, paddingHorizontal: spacing.base, height: 56, ...textStyles.body, fontSize: 16, color: colors.textPrimary,
  },
  inputError: { borderColor: colors.error },
  hint: { ...textStyles.caption, color: colors.textMuted, marginTop: spacing.xs },
  errorText: { ...textStyles.bodySmall, color: colors.error, alignSelf: 'flex-start', marginBottom: spacing.sm },
  cta: { width: '100%', height: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 16 },
});
