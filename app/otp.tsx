import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { colors, radius, spacing, textStyles } from '../theme';
import { SafeScreen } from '../components/layout/SafeScreen';
import { AuthDesktopPanel } from '../components/auth/AuthDesktopPanel';
import { useAuthStore } from '../store/authStore';
import { useLocationStore } from '../store/locationStore';
import { authService, AuthFlowError } from '../services/supabase/authService';
import { formatPhoneDisplay } from '../services/phone';
import { routeAfterSignIn } from '../services/startupRoute';
import { sanitizeOtpInput } from '../services/otpExtract';
import { listenForSmsCode, smsAutoReadAvailable } from '../services/smsAutoRead';
import { bannerImg } from '../data/images';

const OTP_LENGTH = 6;
// Supabase Auth refuses a new code for the same number within 60 seconds (sms_max_frequency),
// so the Resend button must not become active any earlier.
const RESEND_SECONDS = 60;
const WIDE_BREAKPOINT = 900;

export default function OtpScreen() {
  const [otp, setOtp] = useState('');
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const shakeX = useSharedValue(0);

  const pendingPhone = useAuthStore((s) => s.pendingPhone);
  const pendingEmail = useAuthStore((s) => s.pendingEmail);
  const selectedLocation = useLocationStore((s) => s.selected);
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const pendingIdentifier = pendingPhone ?? pendingEmail;
  const identifierKind: 'phone' | 'email' = pendingPhone ? 'phone' : 'email';

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  // Auto-read the code from the SMS (Android: Google's one-tap "allow this app to read this message?" screen, no SMS permission).
  // Listens while this screen is open and again after each Resend; stops when it closes. Entering the 6th digit signs in (below).
  const [smsListenRound, setSmsListenRound] = useState(0);
  useEffect(() => {
    if (identifierKind !== 'phone') return;
    return listenForSmsCode((code) => {
      setError(null);
      setOtp(code);
    }, OTP_LENGTH);
  }, [identifierKind, smsListenRound]);

  useEffect(() => {
    if (otp.length !== OTP_LENGTH || verifying) return;
    if (!pendingIdentifier) return;

    let cancelled = false;
    setVerifying(true);
    setError(null);

    const verify = identifierKind === 'phone' ? authService.verifyOtp(pendingIdentifier, otp) : authService.verifyEmailOtp(pendingIdentifier, otp);

    verify
      .then(async () => {
        if (cancelled) return;
        // authStore's onAuthStateChange listener picks up the new
        // session, but fires asynchronously — explicitly wait for the
        // profile here so the role-based destination below (store
        // staff vs. customer) isn't decided on stale/null role data.
        // The code WAS accepted, so a profile that cannot be read right now (weak connection) is not a wrong code: it goes to the
        // start screen, which offers a retry, instead of the "didn't work" message — and never to the name form.
        let profileLoaded = true;
        try {
          await useAuthStore.getState().refreshProfile();
        } catch {
          profileLoaded = false;
        }
        if (cancelled) return;
        const decision = routeAfterSignIn(profileLoaded ? useAuthStore.getState().profile : null, !!selectedLocation);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see app/index.tsx
        router.replace((decision.kind === 'go' ? decision.route : '/') as any);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof AuthFlowError ? e.message : "That code didn't work. Please try again.");
        shakeX.value = withSequence(
          withTiming(-8, { duration: 60 }),
          withTiming(8, { duration: 60 }),
          withTiming(-6, { duration: 60 }),
          withTiming(0, { duration: 60 }),
        );
        setOtp('');
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  const handleResend = async () => {
    if (!pendingIdentifier || resending) return;
    setResending(true);
    setError(null);
    try {
      if (identifierKind === 'phone') await authService.requestOtp(pendingIdentifier);
      else await authService.requestEmailOtp(pendingIdentifier);
      setSeconds(RESEND_SECONDS);
      setSmsListenRound((round) => round + 1);
    } catch (e) {
      setError(e instanceof AuthFlowError ? e.message : "Couldn't resend the code. Please try again.");
    } finally {
      setResending(false);
    }
  };

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  const formContent = (
    <>
      <Text style={styles.title}>Enter OTP</Text>
      <Text style={styles.subtitle}>
        We've sent a {OTP_LENGTH}-digit code to{'\n'}
        <Text style={styles.phone}>
          {pendingIdentifier ? (identifierKind === 'phone' ? formatPhoneDisplay(pendingIdentifier) : pendingIdentifier) : 'you'}
        </Text>
      </Text>

      <Animated.View style={[styles.boxRow, shakeStyle]}>
        {Array.from({ length: OTP_LENGTH }).map((_, i) => (
          <Pressable key={i} onPress={() => inputRef.current?.focus()} style={[styles.box, error && styles.boxError, otp.length === i && styles.boxActive]}>
            <Text style={styles.boxText}>{otp[i] ?? ''}</Text>
          </Pressable>
        ))}
      </Animated.View>

      <TextInput
        ref={inputRef}
        value={otp}
        onChangeText={(t) => {
          setError(null);
          setOtp(sanitizeOtpInput(t, OTP_LENGTH));
        }}
        keyboardType="number-pad"
        autoFocus
        editable={!verifying}
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        importantForAutofill="yes"
        style={styles.hiddenInput}
      />

      {identifierKind === 'phone' && (
        <Text style={styles.autoReadHint}>
          {smsAutoReadAvailable
            ? 'We\'ll fill the code in when the SMS arrives — tap Allow when your phone asks. You can also type it.'
            : 'Tap the code your keyboard suggests when the SMS arrives, or type it.'}
        </Text>
      )}

      {verifying && (
        <View style={styles.verifyingRow}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.verifyingText}>Verifying...</Text>
        </View>
      )}
      {error && !verifying && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.resendRow}>
        {seconds > 0 ? (
          <Text style={styles.resendMuted}>Resend OTP in {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, '0')}</Text>
        ) : resending ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Pressable onPress={handleResend}>
            <Text style={styles.resendActive}>Resend OTP</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.back()}>
          <Text style={styles.changeNumber}>{identifierKind === 'phone' ? 'Change number' : 'Change email'}</Text>
        </Pressable>
      </View>
    </>
  );

  if (isWide) {
    return (
      <View style={styles.wideContainer}>
        <AuthDesktopPanel
          image={bannerImg('premium dry fruits assortment', 42)}
          eyebrow="Premium Dry Fruits & Spices"
          title={'A Trusted\nHeritage'}
          subtitle="Generations of quality, one quick verification away from your doorstep."
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

const BOX = 46;

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.huge },
  wideContainer: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  wideFormSide: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  wideCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary },
  subtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 21 },
  phone: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  boxRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xxl },
  box: {
    width: BOX,
    height: BOX + 8,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: colors.primary },
  boxError: { borderColor: colors.error },
  boxText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: colors.textPrimary },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  autoReadHint: { ...textStyles.bodySmall, color: colors.textMuted, marginTop: spacing.md, lineHeight: 18 },
  verifyingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  verifyingText: { ...textStyles.bodySmall, color: colors.textSecondary },
  errorText: { ...textStyles.bodySmall, color: colors.error, marginTop: spacing.md },
  resendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl },
  resendMuted: { ...textStyles.bodySmall, color: colors.textMuted },
  resendActive: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  changeNumber: { ...textStyles.bodySmall, color: colors.textSecondary },
});
