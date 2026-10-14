import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import { colors, spacing } from '../../theme';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { LocationHeader } from '../../components/home/LocationHeader';
import { SearchBar } from '../../components/home/SearchBar';
import { HeroCarousel } from '../../components/home/HeroCarousel';
import { HeritageStrip } from '../../components/home/HeritageStrip';
import { CategoryRail } from '../../components/home/CategoryRail';
import { NeedGrid } from '../../components/home/NeedGrid';
import { EditorialBanner } from '../../components/home/EditorialBanner';
import { ProductRail } from '../../components/product/ProductRail';
import { HomeSkeleton } from '../../components/skeletons/HomeSkeleton';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { WifiOff } from 'lucide-react-native';
import { useAsync } from '../../hooks/useAsync';
import { productRepository } from '../../services/repositories/productRepository';
import { categoryRepository } from '../../services/repositories/categoryRepository';
import { bannerRepository } from '../../services/repositories/bannerRepository';
import { useAuthStore } from '../../store/authStore';
import { useNotificationsStore } from '../../store/notificationsStore';
import { categoryImg } from '../../data/images';

const WIDE_BREAKPOINT = 900;
const WIDE_CONTENT_MAX_WIDTH = 1280;

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const profile = useAuthStore((s) => s.profile);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  const { data, loading, error, reload } = useAsync(async () => {
    const [categories, needTags, bestsellers, premium, newArrivals, giftHampers, healthyPicks, banners] =
      await Promise.all([
        categoryRepository.listTopLevel(),
        categoryRepository.listNeedTags(),
        productRepository.listBestsellers(),
        productRepository.listPremium(),
        productRepository.listNewArrivals(),
        productRepository.listGiftHampers(),
        productRepository.listByTag('healthy-snacking'),
        bannerRepository.list(),
      ]);
    return {
      categories,
      needTags,
      bestsellers,
      premium,
      newArrivals,
      giftHampers,
      healthyPicks,
      banners,
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 600));
    reload();
    setRefreshing(false);
  }, [reload]);

  // section 15: a failed fetch must surface a real error + retry, never
  // sit on the loading skeleton forever (this exact gap once hid a real
  // backend bug — a bad column reference in productRepository — as a
  // silently-stuck-loading home screen on every platform).
  if (error && !data) {
    return (
      <SafeScreen>
        <EmptyState
          icon={WifiOff}
          title="Couldn't load the home screen"
          subtitle={error.message || 'Something went wrong. Please check your connection and try again.'}
          ctaLabel="Retry"
          onPressCta={reload}
        />
      </SafeScreen>
    );
  }

  if (loading || !data) {
    return (
      <SafeScreen>
        <HomeSkeleton />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <Head>
        <title>Govind Pansari — Premium Dry Fruits, Spices &amp; Gifting, Agra</title>
        <meta
          name="description"
          content="Shop premium dry fruits, spices, sweets and gift hampers online from Govind Pansari, Agra. Fresh stock, fast delivery, trusted since generations."
        />
        <meta property="og:title" content="Govind Pansari — Premium Dry Fruits, Spices & Gifting" />
        <meta property="og:type" content="website" />
      </Head>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={isWide && styles.wideInner}>
          {/* DesktopHeader already carries location + search + a
              notification bell on wide viewports (section 5) — showing
              this mobile row too would just duplicate it. */}
          {!isWide && (
            <>
              <LocationHeader avatarUrl={profile?.avatarUrl} unreadNotifications={unreadCount} />
              <SearchBar />
            </>
          )}

          <View style={styles.sectionGap} />
          <HeroCarousel banners={data.banners} containerWidth={isWide ? WIDE_CONTENT_MAX_WIDTH : undefined} />

          <View style={styles.sectionGap} />
          <HeritageStrip />

          <View style={styles.sectionGap} />
          <SectionHeader title="Shop by Category" onPressViewAll={() => router.push('/(tabs)/categories')} />
          <CategoryRail categories={data.categories} />

          <View style={styles.sectionGap} />
          <SectionHeader title="Shop by Need" />
          <NeedGrid needs={data.needTags} />

          <View style={styles.sectionGap} />
          <ProductRail title="Most Loved" products={data.bestsellers} onPressViewAll={() => router.push('/(tabs)/categories')} />

          <View style={styles.sectionGap} />
          <EditorialBanner
            eyebrow="Signature"
            title={'Build Your Own\nDry Fruit Box'}
            subtitle="Pick your favourites & create a perfect gift box."
            image={categoryImg('gift box dry fruits assortment', 21)}
            ctaLabel="Build Now"
            badgeText={'Save up to\n20%'}
            onPress={() => router.push('/build-your-box')}
          />

          <View style={styles.sectionGap} />
          <ProductRail title="Premium Collection" products={data.premium} />

          <View style={styles.sectionGap} />
          <ProductRail title="New Arrivals" products={data.newArrivals} />

          <View style={styles.sectionGap} />
          <ProductRail title="Healthy Picks" products={data.healthyPicks} />

          <View style={styles.sectionGap} />
          <ProductRail
            title="Gift Worthy"
            products={data.giftHampers}
            onPressViewAll={() => router.push('/gifting')}
          />

          <View style={{ height: 140 }} />
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xl },
  contentWide: { alignItems: 'center' },
  wideInner: { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH, paddingTop: spacing.lg },
  sectionGap: { height: spacing.xl },
});
