import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { userRepository } from '../../services/repositories/userRepository';
import { useAuthStore } from '../../store/authStore';

const WILL_BE_DELETED = [
  'Your name, email and mobile number',
  'Your saved delivery addresses',
  'Your cart and wishlist',
  'Your product reviews',
  'Your notifications and settings',
];

/** Account deletion, as required by Google Play and the App Store: the customer reads what goes, types DELETE, and the server does the rest. */
export default function DeleteAccountScreen() {
  const logout = useAuthStore((s) => s.logout);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim() === 'DELETE';

  const handleDelete = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await userRepository.deleteAccount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't delete your account. Please try again.");
      setBusy(false);
      return;
    }
    // The account is gone on the server: clear everything held on this phone and go back to sign-in.
    await logout().catch(() => {});
    router.replace('/login');
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8} disabled={busy}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>Delete Account</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>This permanently deletes your Govind Pansari account. It cannot be undone.</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Deleted straight away</Text>
            {WILL_BE_DELETED.map((line) => (
              <Text key={line} style={styles.bullet}>•  {line}</Text>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Kept, without your name</Text>
            <Text style={styles.body}>
              Past orders and payment records must be kept for tax and consumer law. They no longer carry your name, phone number or street address — only the city and pincode, the items, amounts and dates.
            </Text>
          </View>

          <Text style={styles.body}>
            If an order is still on its way, wait until it is delivered or cancelled. If you order again later with this number it will be a new account.
          </Text>

          <View style={{ gap: spacing.xs }}>
            <Text style={styles.label}>Type DELETE to confirm</Text>
            <TextInput
              style={styles.input}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              selectionColor={colors.primary}
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={[styles.deleteBtn, { opacity: ready && !busy ? 1 : 0.45 }]} onPress={handleDelete} disabled={!ready || busy}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.deleteBtnText}>Permanently delete my account</Text>}
          </Pressable>
          <Pressable style={styles.cancelBtn} onPress={() => router.back()} disabled={busy}>
            <Text style={styles.cancelBtnText}>Keep my account</Text>
          </Pressable>
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
  lead: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, gap: spacing.xs, ...shadows.sm },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14.5, color: colors.textPrimary },
  bullet: { ...textStyles.bodySmall, color: colors.textSecondary },
  body: { ...textStyles.bodySmall, color: colors.textSecondary },
  label: { ...textStyles.caption, color: colors.textSecondary },
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
  error: { ...textStyles.bodySmall, color: colors.error },
  deleteBtn: { height: 52, backgroundColor: colors.error, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { ...textStyles.button, color: colors.white, fontSize: 16 },
  cancelBtn: { height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { ...textStyles.button, color: colors.primary, fontSize: 15 },
});
