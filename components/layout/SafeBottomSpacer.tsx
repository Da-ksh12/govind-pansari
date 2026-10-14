import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../../theme';

interface SafeBottomSpacerProps {
  /** Design-system floor for the gap even on a device with a near-zero
   * bottom inset (e.g. 3-button nav or an older device) — defaults to
   * spacing.xxl, the value most screens already used before this. */
  minHeight?: number;
}

/**
 * The one reusable trailing-scroll-content spacer (Final Release
 * Hardening, section 21/49) — a screen's last interactive element
 * (Log Out, Cancel Order, a CTA) must never end up hidden behind the
 * Android gesture bar or 3-button nav. A bare fixed spacing.xxl was
 * previously copy-pasted at the end of ~9 screens' ScrollViews,
 * which is only ever a coincidence when it happens to be taller than
 * the real device inset — this actually measures it.
 */
export function SafeBottomSpacer({ minHeight = spacing.xxl }: SafeBottomSpacerProps) {
  const insets = useSafeAreaInsets();
  return <View style={{ height: Math.max(insets.bottom, minHeight) }} />;
}
