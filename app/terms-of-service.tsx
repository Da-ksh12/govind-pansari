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
    title: '1. Agreement',
    body: 'By creating an account or placing an order with Govind Pansari, you agree to these terms. If you don\'t agree, please don\'t use the app.',
  },
  {
    title: '2. Who can order',
    body: 'You must be able to enter a legally binding contract under Indian law to place an order. Orders are only delivered to addresses within our current delivery areas in Agra — the app will tell you if an address isn\'t serviceable yet.',
  },
  {
    title: '3. Products, pricing & availability',
    body: 'We aim to keep product listings, prices, weights and photos accurate, but occasional errors can happen. If a product is out of stock or a price was listed incorrectly, we\'ll tell you before the order is confirmed rather than silently substitute or overcharge. Prices include applicable taxes unless stated otherwise.',
  },
  {
    title: '4. Orders & payment',
    body: 'An order is confirmed once the store accepts it, not just once you tap "Place Order". Orders are currently paid by Cash on Delivery — please have the exact/appropriate amount ready for the rider. Online payment methods, when enabled, will be processed securely by a licensed third-party payment gateway.',
  },
  {
    title: '5. Delivery',
    body: 'Delivery times shown in the app (typically 25–35 minutes) are estimates, not guarantees — traffic, weather and order volume can affect them. You\'re responsible for providing an accurate delivery address and being reachable at the number on the order. If a delivery genuinely can\'t be completed after reasonable attempts, we\'ll contact you to resolve it.',
  },
  {
    title: '6. Cancellations',
    body: 'You can cancel an order yourself, free of charge, any time before the store starts packing it, from the order\'s details screen. Once packing has started, cancellation isn\'t available in-app — contact support and we\'ll do our best to help.',
  },
  {
    title: '7. Returns & refunds',
    body: 'We accept returns within 7 days for unopened, unused products. If an item arrives damaged, spoiled, or different from what you ordered, contact us with photos via Help & Support and we\'ll arrange a replacement or refund. For Cash on Delivery orders, refunds are settled directly with you (e.g. on your next order or by other agreed means) since no online payment was collected to reverse.',
  },
  {
    title: '8. Your conduct',
    body: 'Please don\'t place fraudulent orders, provide false delivery details, or be abusive toward our store or delivery staff — we reserve the right to refuse service or cancel orders in cases of genuine misuse.',
  },
  {
    title: '9. Reviews',
    body: 'You may leave a rating and review for products from orders you\'ve actually received. Reviews should be honest and relevant to the product — we may remove reviews that are abusive, fake, or unrelated to the product.',
  },
  {
    title: '10. Limitation of liability',
    body: 'We work to fulfil every order accurately and on time, but to the extent permitted by law, our liability for any issue with an order is limited to the value of that order (replacement, refund, or store credit) rather than any indirect or consequential loss.',
  },
  {
    title: '11. Changes to these terms',
    body: 'We may update these terms as the app and business change. Continuing to use the app after an update means you accept the revised terms.',
  },
  {
    title: '12. Contact us',
    body: `Questions about these terms? Reach us at ${SUPPORT_PHONE_NUMBER} or via Help & Support in the app.`,
  },
];

export default function TermsOfServiceScreen() {
  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>Terms of Service</Text>
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
