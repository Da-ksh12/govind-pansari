import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Gift, Leaf, MessageCircle, Nut, Store as StoreIcon, Wheat } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../components/layout/SafeBottomSpacer';
import { Monogram } from '../components/brand/Wordmark';
import { TrustBadgeRow } from '../components/ui/TrustBadgeRow';

const OFFERINGS = [
  { icon: Nut, title: 'Dry Fruits', subtitle: 'Handpicked almonds, cashews, pistachios & more' },
  { icon: Leaf, title: 'Spices', subtitle: 'Pure, freshly ground everyday & festive spices' },
  { icon: Wheat, title: 'Sweets', subtitle: 'Traditional Agra mithai, made the classic way' },
  { icon: Gift, title: 'Gift Hampers', subtitle: 'Curated boxes for every occasion' },
];

export default function AboutScreen() {
  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>About Us</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Monogram size={96} />
          <Text style={styles.heroTitle}>Govind Pansari</Text>
          <Text style={styles.heroTagline}>Since 1950 · Agra</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Our Story</Text>
          <Text style={styles.body}>
            Govind Pansari has been part of Agra's everyday life since 1950 — three generations of the same family, still
            picking every batch of dry fruits and grinding every spice the way it was done when the shop first opened.
          </Text>
          <Text style={styles.body}>
            What started as a single counter has grown into a trusted name across the city, but the promise hasn't
            changed: real quality, fair prices, and the kind of care you'd expect from a shopkeeper who knows your
            family by name.
          </Text>
          <Text style={styles.body}>
            This app brings that same shop — and that same trust — to your phone, with the same products, the same
            people, delivered to your door.
          </Text>
        </View>

        <Text style={styles.sectionTitleOutside}>What We Offer</Text>
        <View style={styles.offerGrid}>
          {OFFERINGS.map((o) => (
            <View key={o.title} style={styles.offerCard}>
              <View style={styles.offerIcon}>
                <o.icon size={ICON_SIZE.lg} color={colors.primary} strokeWidth={ICON_STROKE} />
              </View>
              <Text style={styles.offerTitle}>{o.title}</Text>
              <Text style={styles.offerSubtitle}>{o.subtitle}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitleOutside}>Why Choose Us</Text>
        <View style={styles.card}>
          <TrustBadgeRow />
        </View>

        <View style={styles.actionsRow}>
          <Pressable style={styles.actionBtn} onPress={() => router.push('/stores')}>
            <StoreIcon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.actionBtnText}>Find Our Stores</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => router.push('/help')}>
            <MessageCircle size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.actionBtnText}>Get in Touch</Text>
          </Pressable>
        </View>

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
  hero: { alignItems: 'center', paddingVertical: spacing.xl },
  heroTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary, marginTop: spacing.md },
  heroTagline: { ...textStyles.body, color: colors.gold, fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, ...shadows.sm },
  sectionTitle: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.sm },
  sectionTitleOutside: { ...textStyles.sectionTitle, fontSize: 16, color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.sm },
  body: { ...textStyles.bodySmall, color: colors.textSecondary, lineHeight: 21, marginBottom: spacing.sm },
  offerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.md },
  offerCard: { width: '47%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, gap: 4, ...shadows.sm },
  offerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  offerTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  offerSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  actionsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primaryTint, borderRadius: radius.md, height: 52 },
  actionBtnText: { ...textStyles.button, color: colors.primary, fontSize: 13 },
});
