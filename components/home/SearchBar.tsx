import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Mic, Search, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { motionDuration } from '../../theme/motion';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

const ROTATING_PLACEHOLDERS = [
  'Search almonds, kaju, masala...',
  'Search cashews, pistachios...',
  'Search gift hampers...',
  'Search garam masala, haldi...',
];

interface SearchBarProps {
  editable?: boolean;
  value?: string;
  onChangeText?: (text: string) => void;
  onSubmitEditing?: () => void;
}

/**
 * `ref` (editable mode only) points at the real underlying TextInput —
 * the owning screen focuses it imperatively (see app/(tabs)/search.tsx),
 * this component never tries to guess when it should grab focus itself.
 *
 * Deliberately just ONE real native TextInput, nothing layered on top
 * of it: no wrapping Pressable capturing the tap instead of the input,
 * no <Text> standing in for a placeholder. A mounted, non-disabled
 * TextInput already focuses on tap by itself — the only reason that
 * ever looks broken is something else intercepting the touch or
 * fighting it for focus, not the TextInput itself, so nothing is added
 * "just in case" here.
 */
export const SearchBar = forwardRef<TextInput, SearchBarProps>(function SearchBar(
  { editable = false, value, onChangeText, onSubmitEditing },
  forwardedRef,
) {
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as TextInput);

  useEffect(() => {
    if (editable) return;
    const interval = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % ROTATING_PLACEHOLDERS.length);
    }, 2600);
    return () => clearInterval(interval);
  }, [editable]);

  // A visible "this is active" cue on focus — the container breathes a
  // little, the TextInput itself is never touched by this animation
  // (an animated TextInput remount/re-layout is exactly what can cost
  // it focus on Android, so the scale lives one level up, on the row).
  const focusProgress = useSharedValue(0);
  useEffect(() => {
    focusProgress.value = withTiming(focused ? 1 : 0, { duration: motionDuration.fast });
  }, [focused, focusProgress]);
  const barAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + focusProgress.value * 0.012 }],
    borderColor: focused ? colors.primary : colors.border,
  }));

  const clear = () => {
    onChangeText?.('');
    // Clearing must never cost focus/keyboard — re-assert it explicitly
    // rather than trust that a sibling Pressable's tap didn't blur the
    // input (it shouldn't, but this makes the guarantee real instead of
    // incidental).
    inputRef.current?.focus();
  };

  const content = (
    <Animated.View style={[styles.bar, editable && styles.barEditable, editable && barAnimatedStyle]}>
      <Search size={ICON_SIZE.md} color={focused ? colors.primary : colors.textSecondary} strokeWidth={ICON_STROKE} />
      {editable ? (
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder="Search products..."
          placeholderTextColor={colors.textMuted}
          // Android draws a native text-cursor drag handle (the
          // teardrop shape below the blinking cursor) whose color was
          // never explicitly set here, so it fell back to the device's
          // own default accent color instead of the brand's — this is
          // what actually controls it.
          selectionColor={colors.primary}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          returnKeyType="search"
          onSubmitEditing={onSubmitEditing}
          autoCapitalize="none"
          autoCorrect={false}
          textAlignVertical="center"
          underlineColorAndroid="transparent"
          multiline={false}
          numberOfLines={1}
        />
      ) : (
        <Text style={styles.placeholder} numberOfLines={1}>
          {ROTATING_PLACEHOLDERS[placeholderIndex]}
        </Text>
      )}
      {editable && !!value ? (
        <Pressable onPress={clear} hitSlop={10}>
          <X size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
        </Pressable>
      ) : (
        !editable && <Mic size={ICON_SIZE.md} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
      )}
    </Animated.View>
  );

  if (editable) return content;

  return (
    <Pressable onPress={() => router.push('/(tabs)/search')} style={styles.wrapper} hitSlop={4}>
      {content}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.base },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.base,
    height: 48,
  },
  // The editable bar (the real search screen) gets a slightly stronger
  // resting shadow than the home-screen teaser — a real input, not a
  // decorative element, should read as clearly interactive at rest.
  barEditable: { ...shadows.xs },
  input: {
    flex: 1,
    // A fixed height, deliberately smaller than the bar's own 48 (never
    // exactly matching it — a same-height input clipped against
    // Android's font-metric box in a real, previously-fixed bug here).
    // No explicit lineHeight fighting it, includeFontPadding:false
    // below removes Android's default extra top padding, and the row's
    // own alignItems:'center' centers this box within the bar — that
    // combination is what actually keeps the text vertically centered.
    height: 40,
    fontFamily: textStyles.body.fontFamily,
    fontSize: textStyles.body.fontSize,
    color: colors.textPrimary,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
  placeholder: { flex: 1, ...textStyles.body, color: colors.textMuted },
});
