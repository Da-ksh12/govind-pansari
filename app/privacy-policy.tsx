import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../components/layout/SafeBottomSpacer';
import { SUPPORT_PHONE_NUMBER } from '../data/contact';

const LAST_UPDATED = 'September 2026';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '1. Who we are',
    body: 'Govind Pansari ("we", "us", "our") operates this app to sell dry fruits, spices, sweets and gift hampers for delivery in Agra, India. This policy explains what information we collect through the app, why, and how you can control it.',
  },
  {
    title: '2. Information we collect',
    body: 'Account details you provide: your name, phone number, and email (if you sign in with email). Delivery details: the addresses you save, including their exact location coordinates, and the recipient name/phone for each address. Location: your device\'s GPS location, only when you choose to use it (e.g. "Use Current Location" or the map pin-picker), to find your delivery area and the nearest store. Order data: what you order, when, and its status, so we and our store/delivery staff can fulfil it. Device data: a push-notification token so we can notify you about your orders, and basic device/app-version info for troubleshooting.',
  },
  {
    title: '3. How we use your information',
    body: 'To create and manage your account and orders. To determine which of our stores can deliver to you and to estimate delivery time. To assign and coordinate delivery riders, including sharing your delivery address and live order status with the rider assigned to your order. To send you order, delivery and account notifications (push and in-app). To respond to support requests you send us. We do not sell your personal information to third parties, and we do not use your data for purposes unrelated to running this service.',
  },
  {
    title: '4. Who we share it with',
    body: 'Supabase, our backend/database provider, stores your data on our behalf under their own security and privacy commitments. Delivery riders see the delivery address and order details for orders assigned to them, and nothing more. Store staff see orders placed at their store. We do not share your data with advertisers or data brokers.',
  },
  {
    title: '5. Payments',
    body: 'Orders are currently paid by Cash on Delivery. Online payment methods, when enabled, will be processed by a licensed third-party payment gateway (e.g. Razorpay) — we do not store your card, UPI or bank details ourselves.',
  },
  {
    title: '6. Your choices',
    body: 'You can edit or delete any saved address at any time. You can turn location permission off in your device settings — the app will still work using a saved address instead of live GPS. You can control which push notifications you receive from Notification Preferences in your profile. You can request a copy of your data, or ask us to delete your account and associated data, by contacting support below.',
  },
  {
    title: '7. Data retention',
    body: 'We keep your order history so you can view past orders and reorder easily, and because Indian tax and consumer-protection law requires certain transaction records to be retained. If you ask us to delete your account, we delete or anonymise personal information that isn\'t legally required to be kept.',
  },
  {
    title: '8. Children',
    body: 'This app is intended for adults placing grocery/gifting orders and is not directed at children under 18.',
  },
  {
    title: '9. Changes to this policy',
    body: 'We may update this policy as the app changes. We\'ll update the "last updated" date above when we do.',
  },
  {
    title: '10. Contact us',
    body: `Questions about this policy or your data? Reach us at ${SUPPORT_PHONE_NUMBER} or via Help & Support in the app.`,
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: {LAST_UPDATED}</Text>
        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{s.title}</Text>
            <Text style={styles.sectionBody}>{s.body}</Text>
          </View>
        ))}
        <SafeBottomSpacer />
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  content: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl },
  updated: { ...textStyles.caption, color: colors.textMuted, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: { ...textStyles.cardTitle, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.xs },
  sectionBody: { ...textStyles.bodySmall, color: colors.textSecondary, lineHeight: 21 },
});
