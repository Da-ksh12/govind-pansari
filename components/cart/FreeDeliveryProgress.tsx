import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { PartyPopper, Truck } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { formatINR } from '../ui/PriceBlock';

interface FreeDeliveryProgressProps {
  progress: number; // 0..1
  amountRemaining: number;
}

export function FreeDeliveryProgress({ progress, amountRemaining }: FreeDeliveryProgressProps) {
  const widthValue = useSharedValue(progress);

  useEffect(() => {
    widthValue.value = withTiming(progress, { duration: 400 });
  }, [progress, widthValue]);

  const barStyle = useAnimatedStyle(() => ({ width: `${Math.round(widthValue.value * 100)}%` }));

  const unlocked = progress >= 1;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {unlocked ? (
          <PartyPopper size={ICON_SIZE.md} color={colors.success} strokeWidth={ICON_STROKE} />
        ) : (
          <Truck size={ICON_SIZE.md} color={colors.success} strokeWidth={ICON_STROKE} />
        )}
        <Text style={styles.text}>
          {unlocked ? 'Free delivery unlocked!' : `Add ${formatINR(amountRemaining)} more for FREE delivery`}
        </Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, barStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.successTint, borderRadius: radius.md, padding: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  text: { ...textStyles.bodySmall, color: colors.success, fontFamily: 'PlusJakartaSans_600SemiBold', flex: 1 },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(47,125,79,0.18)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.success, borderRadius: 3 },
});
