import React, { useRef, useState } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../theme';
import { bannerImg } from '../data/images';
import { useAppStore } from '../store/appStore';
import { SafeScreen } from '../components/layout/SafeScreen';
import { AuthDesktopPanel } from '../components/auth/AuthDesktopPanel';

const { width } = Dimensions.get('window');
const WIDE_BREAKPOINT = 900;

const SLIDES = [
  {
    id: 'premium',
    image: bannerImg('premium dry fruits assortment', 31),
    title: 'Premium, handpicked products',
    subtitle: 'Almonds, cashews, pistachios and more — sourced and selected with care.',
  },
  {
    id: 'delivery',
    image: bannerImg('delivery scooter boxes street', 32),
    title: 'Same-day local delivery',
    subtitle: 'Freshly packed and delivered to your door across Agra.',
  },
  {
    id: 'heritage',
    image: bannerImg('indian heritage sweets shop', 33),
    title: 'A trusted heritage since 1950',
    subtitle: "Govind Pansari — generations of quality you can taste.",
  },
];

export default function OnboardingScreen() {
  const listRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);
  const setOnboarded = useAppStore((s) => s.setOnboarded);
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= WIDE_BREAKPOINT;

  const finish = () => {
    setOnboarded();
    router.replace('/login');
  };

  const next = () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToOffset({ offset: (index + 1) * width, animated: true });
      setIndex(index + 1);
    } else {
      finish();
    }
  };

  // Desktop (section 6): the same brand-imagery panel used by
  // Login/OTP, cycling through the same three slides — a click-through
  // story instead of a horizontal swipe gesture, which doesn't really
  // exist as a desktop interaction.
  if (isWide) {
    const slide = SLIDES[index];
    return (
      <View style={styles.wideContainer}>
        <AuthDesktopPanel image={slide.image} title={slide.title} subtitle={slide.subtitle} />
        <View style={styles.wideFormSide}>
          <Pressable style={styles.wideSkip} onPress={finish}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>

          <View style={styles.wideCard}>
            <View style={styles.wideDots}>
              {SLIDES.map((s, i) => (
                <Pressable key={s.id} onPress={() => setIndex(i)} hitSlop={8}>
                  <View style={[styles.dot, i === index && styles.dotActive]} />
                </Pressable>
              ))}
            </View>

            <Text style={styles.wideCardTitle}>{slide.title}</Text>
            <Text style={styles.wideCardSubtitle}>{slide.subtitle}</Text>

            <Pressable style={styles.cta} onPress={next}>
              <Text style={styles.ctaText}>{index === SLIDES.length - 1 ? 'Start Shopping' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeScreen edges={['top', 'bottom']}>
      <Pressable style={styles.skip} onPress={finish} hitSlop={10}>
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>

      <FlatList
        ref={listRef}
        style={styles.list}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <Image source={{ uri: item.image }} style={styles.image} contentFit="cover" />
            <LinearGradient
              colors={['transparent', colors.background]}
              style={styles.gradient}
              locations={[0, 0.85]}
            />
          </View>
        )}
      />

      <View style={styles.textBlock}>
        <Text style={styles.title}>{SLIDES[index].title}</Text>
        <Text style={styles.subtitle}>{SLIDES[index].subtitle}</Text>

        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View key={s.id} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <Pressable style={styles.cta} onPress={next}>
          <Text style={styles.ctaText}>{index === SLIDES.length - 1 ? 'Start Shopping' : 'Next'}</Text>
        </Pressable>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  skip: { position: 'absolute', top: spacing.lg, right: spacing.lg, zIndex: 10 },
  skipText: { ...textStyles.bodySmall, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  wideContainer: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  wideFormSide: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  wideSkip: { position: 'absolute', top: spacing.xl, right: spacing.xl },
  wideCard: { width: '100%', maxWidth: 420 },
  wideDots: { flexDirection: 'row', gap: 6, marginBottom: spacing.xl },
  wideCardTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28, lineHeight: 34, color: colors.textPrimary },
  wideCardSubtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: spacing.md },
  // The image area flexes to fill whatever space is left above the text
  // block, instead of a fixed height — keeps the CTA position consistent
  // and avoids the image cramping/overflowing the text on small screens.
  list: { flex: 1 },
  slide: { width, height: '100%' },
  image: { width: '100%', height: '100%' },
  gradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 140 },
  textBlock: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, lineHeight: 32, color: colors.textPrimary },
  subtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: spacing.sm },
  dots: { flexDirection: 'row', gap: 6, marginTop: spacing.xl },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { width: 18, backgroundColor: colors.primary },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 16 },
});
