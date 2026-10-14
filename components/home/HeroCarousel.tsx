import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import type { Banner } from '../../types/models';

// Capped rather than raw window width (section 42) — on a desktop
// viewport the hero card lives inside the wide dashboard's centered
// content column, not the full browser width, and the source photos
// are shot at a fixed size that starts to look soft well before 1900px.
const MAX_CARD_WIDTH = 720;
const CARD_HEIGHT_MOBILE = 190;
const CARD_HEIGHT_WIDE = 320;
const AUTO_ADVANCE_MS = 4500;

interface HeroCarouselProps {
  banners: Banner[];
  /** Width of the column this carousel is laid out in (defaults to the window width minus the mobile screen gutters). */
  containerWidth?: number;
}

export function HeroCarousel({ banners, containerWidth }: HeroCarouselProps) {
  const listRef = useRef<FlatList<Banner>>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const pausedRef = useRef(false);
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= 900;
  const CARD_WIDTH = Math.min(containerWidth ?? windowWidth - spacing.base * 2, MAX_CARD_WIDTH);
  const CARD_HEIGHT = isWide ? CARD_HEIGHT_WIDE : CARD_HEIGHT_MOBILE;

  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current || banners.length === 0) return;
      const next = (activeIndex + 1) % banners.length;
      listRef.current?.scrollToOffset({ offset: next * CARD_WIDTH, animated: true });
      setActiveIndex(next);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(interval);
  }, [activeIndex, banners.length]);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / CARD_WIDTH);
    setActiveIndex(index);
  }, []);

  if (banners.length === 0) return null;

  return (
    <View>
      <FlatList
        ref={listRef}
        horizontal
        data={banners}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        pagingEnabled
        snapToInterval={CARD_WIDTH}
        decelerationRate="fast"
        onScrollBeginDrag={() => (pausedRef.current = true)}
        onScrollEndDrag={() => (pausedRef.current = false)}
        onMomentumScrollEnd={onMomentumScrollEnd}
        contentContainerStyle={{ paddingHorizontal: spacing.base }}
        renderItem={({ item }) => (
          <Pressable style={[styles.card, { width: CARD_WIDTH, height: CARD_HEIGHT }]} onPress={() => router.push(item.deepLink as never)}>
            <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient
              colors={
                item.theme === 'dark'
                  ? ['rgba(51,9,15,0.88)', 'rgba(51,9,15,0.35)', 'transparent']
                  : ['rgba(251,243,230,0.92)', 'rgba(251,243,230,0.5)', 'transparent']
              }
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.content}>
              {item.eyebrow && (
                <Text style={[styles.eyebrow, { color: item.theme === 'dark' ? colors.gold : colors.primary }]}>
                  {item.eyebrow.toUpperCase()}
                </Text>
              )}
              <Text
                style={[
                  styles.title,
                  isWide && styles.titleWide,
                  { color: item.theme === 'dark' ? colors.white : colors.textPrimary },
                ]}
              >
                {item.title}
              </Text>
              <Text
                style={[
                  styles.subtitle,
                  { color: item.theme === 'dark' ? 'rgba(255,255,255,0.85)' : colors.textSecondary },
                ]}
              >
                {item.subtitle}
              </Text>
              <View
                style={[
                  styles.cta,
                  { backgroundColor: item.theme === 'dark' ? colors.surface : colors.primary },
                ]}
              >
                <Text style={[styles.ctaText, { color: item.theme === 'dark' ? colors.primary : colors.white }]}>
                  {item.ctaLabel}
                </Text>
                <ArrowRight
                  size={ICON_SIZE.sm}
                  color={item.theme === 'dark' ? colors.primary : colors.white}
                  strokeWidth={ICON_STROKE}
                />
              </View>
            </View>
          </Pressable>
        )}
      />
      <View style={styles.dots}>
        {banners.map((b, i) => (
          <View key={b.id} style={[styles.dot, i === activeIndex && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
  },
  content: { paddingHorizontal: spacing.lg, gap: 4, maxWidth: '75%' },
  eyebrow: { ...textStyles.caption, letterSpacing: 1.2 },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, lineHeight: 30 },
  titleWide: { fontSize: 34, lineHeight: 40 },
  subtitle: { ...textStyles.bodySmall },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  ctaText: { ...textStyles.button, fontSize: 13 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { width: 18, backgroundColor: colors.primary },
});
