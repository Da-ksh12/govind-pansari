import React, { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import BottomSheet from '@gorhom/bottom-sheet';
import { ArrowLeft, ChevronDown, MessageCircle, Package, Phone, CreditCard, Truck, TriangleAlert } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../components/layout/SafeBottomSpacer';
import { AppBottomSheet } from '../components/ui/AppBottomSheet';
import { SUPPORT_PHONE_NUMBER, SUPPORT_WHATSAPP_NUMBER } from '../data/contact';

type TopicKey = 'order' | 'payment' | 'delivery' | 'issue';

const TOPICS: { key: TopicKey; icon: typeof Package; title: string; subtitle: string }[] = [
  { key: 'order', icon: Package, title: 'Order Help', subtitle: 'Track, modify or cancel an order' },
  { key: 'payment', icon: CreditCard, title: 'Payment Help', subtitle: 'Payment failures & refunds' },
  { key: 'delivery', icon: Truck, title: 'Delivery Help', subtitle: 'Delivery timing & partners' },
  { key: 'issue', icon: TriangleAlert, title: 'Report an Issue', subtitle: 'Product quality or damage' },
];

const FAQS = [
  { q: 'How long does delivery take?', a: 'Most orders in Agra are delivered within 25–35 minutes, depending on your location and order volume.' },
  { q: 'What is your return policy?', a: 'We accept returns within 7 days for unopened, unused products. Contact support to initiate a return.' },
  { q: 'Do you offer Cash on Delivery?', a: 'Yes, COD is available for eligible orders and pincodes at checkout.' },
  { q: 'Can I use a coupon code?', a: "Promo codes aren't available in the app yet. Your cart and checkout always show the exact amount you will pay, including delivery." },
];

function whatsAppLink(message: string) {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export default function HelpScreen() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [activeTopic, setActiveTopic] = useState<TopicKey | null>(null);
  const [issueText, setIssueText] = useState('');
  const topicSheetRef = useRef<BottomSheet>(null);

  const openTopic = (key: TopicKey) => {
    setActiveTopic(key);
    topicSheetRef.current?.expand();
  };

  const openOrders = () => {
    topicSheetRef.current?.close();
    router.push('/(tabs)/orders');
  };

  const sendIssueOnWhatsApp = () => {
    const message = issueText.trim()
      ? `Hi Govind Pansari, I'd like to report an issue: ${issueText.trim()}`
      : "Hi Govind Pansari, I'd like to report an issue with my order.";
    Linking.openURL(whatsAppLink(message)).catch(() => {});
    setIssueText('');
    topicSheetRef.current?.close();
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>Help & Support</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topicsGrid}>
          {TOPICS.map((t) => (
            <Pressable key={t.key} style={styles.topicCard} onPress={() => openTopic(t.key)}>
              <t.icon size={ICON_SIZE.lg} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.topicTitle}>{t.title}</Text>
              <Text style={styles.topicSubtitle}>{t.subtitle}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
        <View style={styles.faqCard}>
          {FAQS.map((faq, i) => {
            const open = openFaq === i;
            return (
              <View key={faq.q} style={[styles.faqRow, i === FAQS.length - 1 && { borderBottomWidth: 0 }]}>
                <Pressable style={styles.faqHeader} onPress={() => setOpenFaq(open ? null : i)}>
                  <Text style={styles.faqQuestion}>{faq.q}</Text>
                  <ChevronDown
                    size={ICON_SIZE.sm}
                    color={colors.textSecondary}
                    strokeWidth={ICON_STROKE}
                    style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
                  />
                </Pressable>
                {open && <Text style={styles.faqAnswer}>{faq.a}</Text>}
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Contact Us</Text>
        <View style={styles.contactRow}>
          <Pressable style={styles.contactBtn} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE_NUMBER}`).catch(() => {})}>
            <Phone size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.contactBtnText}>Call Us</Text>
          </Pressable>
          <Pressable style={styles.contactBtn} onPress={() => Linking.openURL(whatsAppLink('Hi Govind Pansari, I need some help.')).catch(() => {})}>
            <MessageCircle size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.contactBtnText}>Chat with Us</Text>
          </Pressable>
        </View>

        <SafeBottomSpacer />
      </ScrollView>

      <AppBottomSheet ref={topicSheetRef} title={TOPICS.find((t) => t.key === activeTopic)?.title} snapPoints={['55%']}>
        {activeTopic === 'order' && (
          <>
            <Text style={styles.sheetText}>
              You can track any order live once it's on its way, and cancel an order yourself right up until the store starts
              packing it — both from that order's details screen.
            </Text>
            <Pressable style={styles.sheetPrimaryBtn} onPress={openOrders}>
              <Text style={styles.sheetPrimaryBtnText}>Go to My Orders</Text>
            </Pressable>
          </>
        )}
        {activeTopic === 'payment' && (
          <Text style={styles.sheetText}>
            We currently accept Cash on Delivery (COD) on every order — online payments are coming soon. If something was
            wrong with a COD payment (wrong amount collected, missing change, etc.), message us on WhatsApp below and we'll
            sort it out.
          </Text>
        )}
        {activeTopic === 'delivery' && (
          <Text style={styles.sheetText}>
            Most orders in Agra are delivered within 25–35 minutes of confirmation. Once your order is packed and a rider is
            on the way, you can watch their live location from the order details screen.
          </Text>
        )}
        {activeTopic === 'issue' && (
          <>
            <Text style={styles.sheetText}>Tell us what went wrong — we'll pick it up on WhatsApp right away.</Text>
            <TextInput
              style={styles.issueInput}
              placeholder="e.g. An item arrived damaged, or my order was missing something…"
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.primary}
              value={issueText}
              onChangeText={setIssueText}
              multiline
              numberOfLines={4}
            />
            <Pressable style={styles.sheetPrimaryBtn} onPress={sendIssueOnWhatsApp}>
              <MessageCircle size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
              <Text style={styles.sheetPrimaryBtnText}>Send via WhatsApp</Text>
            </Pressable>
          </>
        )}
      </AppBottomSheet>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  content: { paddingHorizontal: spacing.base },
  topicsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  topicCard: { width: '47%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, gap: 4, ...shadows.sm },
  topicTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, marginTop: spacing.xs },
  topicSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  sectionTitle: { ...textStyles.sectionTitle, fontSize: 16, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  faqCard: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.base, ...shadows.sm },
  faqRow: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  faqHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  faqQuestion: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  faqAnswer: { ...textStyles.bodySmall, color: colors.textSecondary, paddingBottom: spacing.md, lineHeight: 20 },
  contactRow: { flexDirection: 'row', gap: spacing.md },
  contactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primaryTint, borderRadius: radius.md, height: 52 },
  contactBtnText: { ...textStyles.button, color: colors.primary, fontSize: 14 },
  sheetText: { ...textStyles.body, color: colors.textSecondary, lineHeight: 22 },
  sheetPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.md, height: 50, marginTop: spacing.lg,
  },
  sheetPrimaryBtnText: { ...textStyles.button, color: colors.white, fontSize: 15 },
  issueInput: {
    ...textStyles.body, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.base, marginTop: spacing.base, minHeight: 100, textAlignVertical: 'top',
  },
});
