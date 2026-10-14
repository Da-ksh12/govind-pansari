import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, ArrowRight, Tag } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../components/layout/SafeBottomSpacer';
import { AppImage } from '../components/ui/AppImage';
import { useAsync } from '../hooks/useAsync';
import { offerRepository } from '../services/repositories/offerRepository';

export default function OffersScreen() {
  const { data: offers } = useAsync(() => offerRepository.list(), []);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Offers</Text>
          <Text style={styles.headerSubtitle}>Save more on your favourite picks</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {(offers ?? []).map((offer) => (
          <Pressable key={offer.id} style={styles.card} onPress={() => router.push('/(tabs)/categories')}>
            <AppImage uri={offer.image} style={styles.image} contentFit="cover" borderRadius={0} fallbackIcon={Tag} />
            <View style={styles.overlay} />
            <View style={styles.textBlock}>
              <Text style={styles.title}>{offer.title}</Text>
              <Text style={styles.subtitle}>{offer.subtitle}</Text>
              <View style={styles.cta}>
                <Text style={styles.ctaText}>{offer.ctaLabel}</Text>
                <ArrowRight size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
              </View>
            </View>
          </Pressable>
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
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  content: { paddingHorizontal: spacing.base },
  card: { borderRadius: radius.lg, overflow: 'hidden', height: 150, marginBottom: spacing.md, justifyContent: 'flex-end', ...shadows.sm },
  image: { ...StyleSheet.absoluteFill },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(36,21,18,0.45)' },
  textBlock: { padding: spacing.lg },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19, color: colors.white },
  subtitle: { ...textStyles.bodySmall, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 13 },
});
