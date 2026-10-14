import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Minus, Plus } from 'lucide-react-native';
import { colors, duration, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useCartStore } from '../../store/cartStore';
import { useCartFlyStore } from '../../store/cartFlyStore';
import { AnimatedPressable } from '../motion/AnimatedPressable';
import { AnimatedNumber } from '../motion/AnimatedNumber';

interface AddToCartControlProps {
  productId: string;
  variantId: string;
  size?: 'sm' | 'lg';
  disabled?: boolean;
  /** Product image — when given, tapping Add flies a copy of it toward the cart (section: cart-fly animation). Omit where no product image is on screen. */
  imageUri?: string;
}

const HEIGHT = { sm: 36, lg: 48 } as const;

export function AddToCartControl({ productId, variantId, size = 'sm', disabled, imageUri }: AddToCartControlProps) {
  const quantity = useCartStore((s) => s.quantityForVariant(variantId));
  const increment = useCartStore((s) => s.incrementVariant);
  const decrement = useCartStore((s) => s.decrementVariant);
  const flyToCart = useCartFlyStore((s) => s.fly);
  const addButtonRef = useRef<View>(null);
  const [rollDirection, setRollDirection] = useState<'up' | 'down'>('up');

  const bump = useSharedValue(1);
  const triggerBump = useCallback(() => {
    bump.value = withSequence(withTiming(1.15, { duration: 100 }), withTiming(1, { duration: 140 }));
  }, [bump]);

  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));

  const handleAdd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    increment(productId, variantId);
    triggerBump();
    if (imageUri) {
      addButtonRef.current?.measureInWindow((x, y, width, height) => {
        const size = Math.min(width, height) || 40;
        flyToCart({ uri: imageUri, startX: x + width / 2 - size / 2, startY: y + height / 2 - size / 2, size });
      });
    }
  };

  const handleIncrement = () => {
    Haptics.selectionAsync().catch(() => {});
    setRollDirection('up');
    increment(productId, variantId);
    triggerBump();
  };

  const handleDecrement = () => {
    Haptics.selectionAsync().catch(() => {});
    setRollDirection('down');
    decrement(productId, variantId);
  };

  const h = HEIGHT[size];

  if (quantity <= 0) {
    return (
      <Animated.View exiting={FadeOut.duration(duration.micro)} style={bumpStyle}>
        <Pressable
          ref={addButtonRef}
          onPress={handleAdd}
          disabled={disabled}
          style={({ pressed }) => [
            styles.addButton,
            { height: h, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
          ]}
        >
          <Plus size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
          <Text style={styles.addLabel}>ADD</Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(duration.micro)} style={[styles.stepper, { height: h }, bumpStyle]}>
      <AnimatedPressable onPress={handleDecrement} hitSlop={8} pressScale={0.85} style={styles.stepperButton}>
        <Minus size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
      </AnimatedPressable>
      <AnimatedNumber value={String(quantity)} direction={rollDirection} style={styles.stepperCount} />
      <AnimatedPressable onPress={handleIncrement} hitSlop={8} pressScale={0.85} style={styles.stepperButton}>
        <Plus size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
      </AnimatedPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.base,
  },
  addLabel: {
    ...textStyles.button,
    color: colors.white,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    minWidth: 96,
  },
  stepperButton: {
    padding: 2,
  },
  stepperCount: {
    ...textStyles.cardTitle,
    color: colors.primary,
    minWidth: 18,
    textAlign: 'center',
  },
});
