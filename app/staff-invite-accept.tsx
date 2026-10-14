import React, { useEffect, useState } from 'react';
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
const MIN_PASSWORD_LENGTH = 8;

type Stage = 'checking' | 'ready' | 'no-session' | 'done';

/**
 * Where an admin-invite email link lands (Web only — see
 * authService.setSessionFromInviteUrl). Turns "invited" into "can log
 * in with email+password" by setting a real password on the session
 * the invite link already established.
 */
export default function StaffInviteAcceptScreen() {
  const [stage, setStage] = useState<Stage>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  useEffect(() => {
    authService
      .setSessionFromInviteUrl()
      .then((established) => setStage(established ? 'ready' : 'no-session'))
      .catch(() => setStage('no-session'));
  }, []);

  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && password === confirmPassword && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    try {
      await authService.setPassword(password);
      await useAuthStore.getState().refreshProfile();
      setStage('done');
      const role = useAuthStore.getState().profile?.role;
      setTimeout(() => {
        if (role === 'store_manager' || role === 'staff') router.replace('/store' as never);
        else if (role === 'rider') router.replace('/rider' as never);
        else router.replace('/');
      }, 900);
    } catch (e) {
      setError(e instanceof AuthFlowError ? e.message : "Couldn't set your password. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const formContent = (
    <>
      {!isWide && <Monogram size={80} onDark={false} />}

      {stage === 'checking' && (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {stage === 'no-session' && (
        <>
          <Text style={styles.title}>Link expired or invalid</Text>
          <Text style={styles.subtitle}>
            This invite link isn't valid anymore — it may have already been used, or opened on a different device than the one that
            requested it. Ask whoever invited you to send a new one.
          </Text>
        </>
      )}

      {(stage === 'ready' || stage === 'done') && (
        <>
          <Text style={styles.title}>{stage === 'done' ? "You're all set" : 'Set your password'}</Text>
          <Text style={styles.subtitle}>
            {stage === 'done'
              ? 'Taking you in now…'
              : "Welcome to the Govind Pansari team — set a password to finish setting up your account."}
          </Text>

          {stage === 'ready' && (
            <>
              <View style={[styles.inputRow, error && styles.inputRowError]}>
                <TextInput
                  style={styles.input}
                  placeholder="New password"
                  placeholderTextColor={colors.textMuted}
                  selectionColor={colors.primary}
                  secureTextEntry
                  value={password}
                  onChangeText={(t) => {
                    setError(null);
                    setPassword(t);
                  }}
                  autoFocus
                  editable={!saving}
                />
              </View>
              <View style={[styles.inputRow, styles.inputRowSpaced, error && styles.inputRowError]}>
                <TextInput
                  style={styles.input}
                  placeholder="Confirm password"
                  placeholderTextColor={colors.textMuted}
                  selectionColor={colors.primary}
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={(t) => {
                    setError(null);
                    setConfirmPassword(t);
                  }}
                  editable={!saving}
                />
              </View>
              <Text style={styles.hint}>At least {MIN_PASSWORD_LENGTH} characters.</Text>
              {error && <Text style={styles.errorText}>{error}</Text>}

              <Pressable style={[styles.cta, { opacity: canSubmit ? 1 : 0.5 }]} onPress={handleSubmit} disabled={!canSubmit}>
                {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.ctaText}>Set Password &amp; Continue</Text>}
              </Pressable>
            </>
          )}

          {stage === 'done' && (
            <View style={styles.centerBlock}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
        </>
      )}
    </>
  );

  if (isWide) {
    return (
      <View style={styles.wideContainer}>
        <AuthDesktopPanel
          image={bannerImg('premium dry fruits assortment', 43)}
          eyebrow="Govind Pansari Team"
          title={'Welcome to\nthe Team'}
          subtitle="One quick step to finish setting up your account."
        />
        <View style={styles.wideFormSide}>
          <View style={styles.wideCard}>{formContent}</View>
        </View>
      </View>
    );
  }

  return (
    <SafeScreen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>{formContent}</View>
      </KeyboardAvoidingView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.huge, alignItems: 'center' },
  wideContainer: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  wideFormSide: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  wideCard: {
    width: '100%', maxWidth: 400, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl, borderWidth: 1, borderColor: colors.border,
  },
  centerBlock: { paddingVertical: spacing.xxl },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary, marginTop: spacing.lg, textAlign: 'center' },
  subtitle: { ...textStyles.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xl },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', width: '100%', borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.base, height: 56,
  },
  inputRowSpaced: { marginTop: spacing.sm },
  inputRowError: { borderColor: colors.error },
  input: { flex: 1, ...textStyles.body, fontSize: 16, color: colors.textPrimary },
  hint: { ...textStyles.caption, color: colors.textMuted, marginTop: spacing.xs, alignSelf: 'flex-start' },
  errorText: { ...textStyles.bodySmall, color: colors.error, marginTop: spacing.sm, alignSelf: 'flex-start' },
  cta: { width: '100%', height: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 16 },
});
