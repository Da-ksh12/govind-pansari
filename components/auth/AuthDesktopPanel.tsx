import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, textStyles } from '../../theme';
import { Monogram } from '../brand/Wordmark';

interface AuthDesktopPanelProps {
  image: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
}

/**
 * Left-hand brand/imagery panel shared by the desktop Login, OTP and
 * Onboarding screens (section 6/42) — one consistent visual language
 * across the whole pre-auth funnel instead of three separately
 * stretched mobile screens. Native module dependencies only
 * (expo-image, expo-linear-gradient), both already used elsewhere on
 * web in this app.
 */
export function AuthDesktopPanel({ image, eyebrow, title, subtitle }: AuthDesktopPanelProps) {
  return (
    <View style={styles.panel}>
      <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
      <LinearGradient
        colors={['rgba(51,9,15,0.35)', 'rgba(51,9,15,0.55)', 'rgba(20,6,9,0.88)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.brandRow}>
        <Monogram size={56} onDark />
      </View>

      <View style={styles.textBlock}>
        {eyebrow && <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>}
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    maxWidth: 560,
    padding: spacing.xxl,
    justifyContent: 'space-between',
    overflow: 'hidden',
    backgroundColor: colors.primaryDarker,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  textBlock: { maxWidth: 420 },
  eyebrow: { ...textStyles.caption, color: colors.gold, letterSpacing: 1.5, marginBottom: spacing.sm },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 34, lineHeight: 40, color: colors.white },
  subtitle: { ...textStyles.body, color: 'rgba(255,255,255,0.82)', marginTop: spacing.md },
});
