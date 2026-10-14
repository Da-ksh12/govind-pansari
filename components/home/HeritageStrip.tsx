import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Award, MapPin, ShieldCheck } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { motionDuration } from '../../theme/motion';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const ITEMS = [
  { icon: Award, label: 'Since 1950' },
  { icon: ShieldCheck, label: 'Premium Quality' },
  { icon: MapPin, label: 'Trusted in Agra' },
];

/**
 * The home screen's brand-heritage strip (motion system, section 9) —
 * distinct from `TrustBadgeRow` (operational: delivery/packaging/returns,
 * used on category screens). This one is the "we are a real, decades-old
 * business" cue, and previously existed nowhere in the app. Deliberately
 * quiet: a single gentle fade-in on mount, no looping motion — heritage
 * is stated once, not performed continuously.
 */
export function HeritageStrip() {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(motionDuration.emphasis)} style={styles.wrap}>
      <Text style={styles.eyebrow}>A Legacy You Can Trust</Text>
      <View style={styles.row}>
        {ITEMS.map((item) => (
          <View key={item.label} style={styles.item}>
            <View style={styles.iconCircle}>
              <item.icon size={ICON_SIZE.sm} color={colors.gold} strokeWidth={ICON_STROKE} />
            </View>
            <Text style={styles.label}>{item.label}</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.base,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
  },
  eyebrow: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 15,
    color: colors.white,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  item: { alignItems: 'center', gap: 4 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.gold,
  },
  label: { ...textStyles.caption, color: colors.white, fontSize: 10.5, textAlign: 'center' },
});
