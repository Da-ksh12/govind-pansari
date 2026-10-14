import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../theme';
import { Monogram } from '../components/brand/Wordmark';
import { AuthDesktopPanel } from '../components/auth/AuthDesktopPanel';
import { SafeScreen } from '../components/layout/SafeScreen';
import { useAuthStore } from '../store/authStore';
import { authService } from '../services/supabase/authService';
import { isValidIndianMobile, toE164 } from '../services/phone';
import { bannerImg } from '../data/images';

const WIDE_BREAKPOINT = 900;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setPendingPhone = useAuthStore((s) => s.setPendingPhone);
  const setPendingEmail = useAuthStore((s) => s.setPendingEmail);
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const canContinue = mode === 'phone' ? isValidIndianMobile(phone) && !loading : EMAIL_RE.test(email.trim()) && !loading;

  const handleContinue = async () => {
    if (!canContinue) return;
    setError(null);
    setLoading(true);
    try {
      if (mode === 'phone') {
        const e164 = toE164(phone);
        await authService.requestOtp(e164);
        setPendingPhone(e164);
      } else {
        const trimmed = email.trim().toLowerCase();
        await authService.requestEmailOtp(trimmed);
        setPendingEmail(trimmed);
      }
      router.push('/otp');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setError(null);
    setMode((m) => (m === 'phone' ? 'email' : 'phone'));
  };

  const formContent = (
    <>
      {!isWide && <Monogram size={80} onDark={false} />}
      <Text style={[styles.title, isWide && styles.titleWide]}>Welcome back</Text>
      <Text style={styles.subtitle}>
        {mode === 'phone' ? 'Sign in to continue shopping premium dry fruits & spices.' : "Sign in with your email — we'll send a 6-digit code."}
      </Text>

      {mode === 'phone' ? (
        <View style={[styles.inputRow, error && styles.inputRowError]}>
          <Text style={styles.prefix}>+91</Text>
          <TextInput
            style={styles.input}
            placeholder="Mobile number"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            keyboardType="number-pad"
            maxLength={10}
            value={phone}
            onChangeText={(t) => {
              setError(null);
              setPhone(t.replace(/[^0-9]/g, ''));
            }}
            autoFocus
            editable={!loading}
          />
        </View>
      ) : (
        <View style={[styles.inputRow, error && styles.inputRowError]}>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={(t) => {
              setError(null);
              setEmail(t);
            }}
            autoFocus
            editable={!loading}
          />
        </View>
      )}
      {error && <Text style={styles.errorText}>{error}</Text>}

      <Pressable
        style={[styles.cta, { opacity: canContinue ? 1 : 0.5 }]}
        onPress={handleContinue}
        disabled={!canContinue}
      >
        {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.ctaText}>Continue</Text>}
      </Pressable>

      <Pressable onPress={switchMode} hitSlop={8} style={styles.switchModeBtn}>
        <Text style={styles.switchModeText}>
          {mode === 'phone' ? 'Continue with email instead' : 'Continue with phone number instead'}
        </Text>
      </Pressable>

      <Text style={styles.terms}>
        By continuing, you agree to Govind Pansari's{' '}
        <Text style={styles.termsLink} onPress={() => router.push('/terms-of-service' as never)}>
          Terms of Service
        </Text>{' '}
        &{' '}
        <Text style={styles.termsLink} onPress={() => router.push('/privacy-policy' as never)}>
          Privacy Policy
        </Text>
        .
      </Text>

      <Pressable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- app/staff-login.tsx is new; .expo/types/router.d.ts needs a local `expo start` (network access) to regenerate. Real, valid route.
        onPress={() => router.push('/staff-login' as any)}
        hitSlop={8}
        style={styles.teamLinkBtn}
      >
        <Text style={styles.teamLinkText}>Store manager or rider? Team sign in</Text>
      </Pressable>
    </>
  );

  // Desktop (section 6): a split screen — brand imagery + story on the
  // left, the same phone-auth form/state/logic as mobile in a centered
  // card on the right, instead of mobile fields stretched edge to edge.
  if (isWide) {
    return (
      <View style={styles.wideContainer}>
        <AuthDesktopPanel
          image={bannerImg('premium dry fruits assortment', 41)}
          eyebrow="Premium Dry Fruits & Spices"
          title={'Quality You\nCan Taste'}
          subtitle="Handpicked almonds, cashews, pistachios & more — sourced with care, delivered fresh across Agra."
        />
        <View style={styles.wideFormSide}>
          <View style={styles.wideCard}>{formContent}</View>
        </View>
      </View>
    );
  }

  return (
    <SafeScreen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  titleWide: { marginTop: 0 },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary, marginTop: spacing.lg },
  subtitle: {
    ...textStyles.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.base,
    height: 56,
  },
  inputRowError: { borderColor: colors.error },
  prefix: { ...textStyles.body, color: colors.textPrimary, marginRight: spacing.sm, fontFamily: 'PlusJakartaSans_600SemiBold' },
  input: { flex: 1, ...textStyles.body, fontSize: 16, color: colors.textPrimary },
  errorText: { ...textStyles.bodySmall, color: colors.error, marginTop: spacing.sm, alignSelf: 'flex-start' },
  cta: {
    width: '100%',
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 16 },
  switchModeBtn: { marginTop: spacing.lg },
  switchModeText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  teamLinkBtn: { marginTop: spacing.md, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  teamLinkText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  terms: { ...textStyles.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl, lineHeight: 16 },
  termsLink: { color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
});
