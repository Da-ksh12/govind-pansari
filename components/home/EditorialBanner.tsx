import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { ArrowRight } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

interface EditorialBannerProps {
  eyebrow?: string;
  title: string;
  subtitle: string;
  image: string;
  ctaLabel: string;
  badgeText?: string;
  onPress: () => void;
}

export function EditorialBanner({ eyebrow, title, subtitle, image, ctaLabel, badgeText, onPress }: EditorialBannerProps) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.textCol}>
        {eyebrow && <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
          <ArrowRight size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
        </View>
      </View>
      <Image source={{ uri: image }} style={styles.image} contentFit="cover" />
      {badgeText && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.base,
    backgroundColor: colors.primaryDarker,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    minHeight: 150,
  },
  textCol: { flex: 1, padding: spacing.lg, gap: 4 },
  eyebrow: { ...textStyles.caption, color: colors.gold, letterSpacing: 1 },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 21, lineHeight: 25, color: colors.white },
  subtitle: { ...textStyles.bodySmall, color: 'rgba(255,255,255,0.8)' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 13 },
  image: { width: 130, height: 150 },
  badge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: colors.gold,
    borderRadius: 999,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...textStyles.caption,
    color: colors.primaryDarker,
    fontFamily: 'PlusJakartaSans_700Bold',
    textAlign: 'center',
    fontSize: 10.5,
  },
});
