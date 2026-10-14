import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../theme';
import { Monogram } from '../components/brand/Wordmark';
import { AuthDesktopPanel } from '../components/auth/AuthDesktopPanel';
import { SafeScreen } from '../components/layout/SafeScreen';
import { authService, AuthFlowError } from '../services/supabase/authService';
import { useAuthStore } from '../store/authStore';
import { bannerImg } from '../data/images';

const WIDE_BREAKPOINT = 900;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email+password sign-in for invited store managers/riders — a deliberately separate flow from customer phone+OTP (app/login.tsx). */
export default function StaffLoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const canContinue = EMAIL_RE.test(email.trim()) && password.length > 0 && !loading;

  const handleContinue = async () => {
    if (!canContinue) return;
    setError(null);
    setLoading(true);
    try {
      await authService.signInWithEmailPassword(email.trim(), password);
      await useAuthStore.getState().refreshProfile();
      const role = useAuthStore.getState().profile?.role;
      if (role === 'store_manager' || role === 'staff') router.replace('/store' as never);
      else if (role === 'rider') router.replace('/rider' as never);
      else if (role === 'admin') router.replace('/admin' as never);
      else router.replace('/');
    } catch (e) {
      // signInWithPassword's invalid_credentials maps to the OTP-flavoured
      // "code is incorrect" message, which reads wrong for a password
      // field — override with password-appropriate copy here.
      if (e instanceof AuthFlowError && e.code === 'INVALID_OTP') setError('Incorrect email or password.');
      else setError(e instanceof AuthFlowError ? e.message : "Couldn't sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const formContent = (
    <>
      {!isWide && <Monogram size={80} onDark={false} />}
      <Text style={[styles.title, isWide && styles.titleWide]}>Team Sign In</Text>
      <Text style={styles.subtitle}>For invited store managers and riders.</Text>

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
      <View style={[styles.inputRow, styles.inputRowSpaced, error && styles.inputRowError]}>
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          secureTextEntry
          value={password}
          onChangeText={(t) => {
            setError(null);
            setPassword(t);
          }}
          editable={!loading}
          onSubmitEditing={handleContinue}
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <Pressable style={[styles.cta, { opacity: canContinue ? 1 : 0.5 }]} onPress={handleContinue} disabled={!canContinue}>
        {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.ctaText}>Sign In</Text>}
      </Pressable>

      <Pressable onPress={() => router.replace('/login')} hitSlop={8} style={styles.switchModeBtn}>
        <Text style={styles.switchModeText}>Shopping instead? Customer sign in</Text>
      </Pressable>
    </>
  );

  if (isWide) {
    return (
      <View style={styles.wideContainer}>
        <AuthDesktopPanel
          image={bannerImg('premium dry fruits assortment', 44)}
          eyebrow="Govind Pansari Team"
          title={'Run the\nOperation'}
          subtitle="Store managers and riders — sign in to your operational dashboard."
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
    width: '100%', maxWidth: 400, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, borderWidth: 1, borderColor: colors.border,
  },
  titleWide: { marginTop: 0 },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary, marginTop: spacing.lg },
  subtitle: { ...textStyles.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xxl },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.base, height: 56,
  },
  inputRowSpaced: { marginTop: spacing.sm },
  inputRowError: { borderColor: colors.error },
  input: { flex: 1, ...textStyles.body, fontSize: 16, color: colors.textPrimary },
  errorText: { ...textStyles.bodySmall, color: colors.error, marginTop: spacing.sm, alignSelf: 'flex-start' },
  cta: { width: '100%', height: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 16 },
  switchModeBtn: { marginTop: spacing.lg },
  switchModeText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
});
