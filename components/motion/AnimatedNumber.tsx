import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { motionDuration } from '../../theme/motion';

interface AnimatedNumberProps {
  /** Fully-formatted display string (e.g. "2", "₹449", "12 min") — this component doesn't format, just animates the transition when it changes. */
  value: string;
  style?: StyleProp<TextStyle>;
  /** Direction the outgoing value exits — 'up' for a count increasing (default), 'down' for decreasing, so it reads as a real odometer roll rather than a generic crossfade. */
  direction?: 'up' | 'down';
}

/**
 * Section 9/28: quantity, ETA and price all "roll" through this same
 * primitive instead of instantly swapping text — the outgoing value
 * slides+fades one way, the incoming value slides+fades in from the
 * other, keyed by the value itself so React mounts a fresh node per
 * change and lets Reanimated's layout-aware entering/exiting animate
 * the swap.
 */
export function AnimatedNumber({ value, style, direction = 'up' }: AnimatedNumberProps) {
  const entering = direction === 'up' ? FadeInUp.duration(motionDuration.fast) : FadeInUp.duration(motionDuration.fast).withInitialValues({ transform: [{ translateY: -10 }] });
  const exiting = direction === 'up' ? FadeOutUp.duration(motionDuration.fast) : FadeOutUp.duration(motionDuration.fast);

  return (
    <View style={styles.clip}>
      <Animated.Text key={value} entering={entering} exiting={exiting} layout={LinearTransition.duration(motionDuration.fast)} style={style}>
        {value}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
