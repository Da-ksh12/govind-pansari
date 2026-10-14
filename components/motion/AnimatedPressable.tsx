import React from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { spring } from '../../theme/motion';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

interface AnimatedPressableCompProps extends PressableProps {
  style?: StyleProp<ViewStyle>;
  /** How much to shrink on press — 0.95 for a card, 0.9 for a small icon/button. Default 0.96. */
  pressScale?: number;
  children?: React.ReactNode;
}

/**
 * The one press-physics wrapper for the whole app — compress on press,
 * spring back on release. Section 11/36: product cards, buttons, chips
 * all route through this instead of each screen hand-rolling its own
 * useSharedValue/useAnimatedStyle pair.
 */
export function AnimatedPressable({ style, pressScale = 0.96, onPressIn, onPressOut, children, ...rest }: AnimatedPressableCompProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressableBase
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        scale.value = withSpring(pressScale, spring.snappy);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, spring.snappy);
        onPressOut?.(e);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressableBase>
  );
}
