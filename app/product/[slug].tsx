import React, { useMemo, useState } from 'react';
import { Dimensions, Pressable, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Head from 'expo-router/head';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Award,
  Box,
  ChevronRight,
  HeartPulse,
  Leaf,
  Share2,
  Snowflake,
  Truck,
} from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AppImage } from '../../components/ui/AppImage';
import { ProductBadgePill } from '../../components/ui/Badge';
import { Chip } from '../../components/ui/Badge';
import { PriceBlock, formatINR } from '../../components/ui/PriceBlock';
import { Rating } from '../../components/ui/Rating';
import { AccordionItem } from '../../components/ui/Accordion';
import { AddToCartControl } from '../../components/ui/AddToCartControl';
import { AnimatedWishlistHeart } from '../../components/motion/AnimatedWishlistHeart';
import { ProductRail } from '../../components/product/ProductRail';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProductDetailSkeleton } from '../../components/skeletons/ProductDetailSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { useFilteredRecommendations } from '../../hooks/useFilteredRecommendations';
import { productRepository } from '../../services/repositories/productRepository';
import { useWishlistStore } from '../../store/wishlistStore';
import { useCartStore } from '../../store/cartStore';
import type { ProductInfoSection, ProductVariant } from '../../types/models';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const WIDE_BREAKPOINT = 900;

const INFO_ICONS: Record<ProductInfoSection['key'], typeof Leaf> = {
  about: Leaf,
  quality_origin: Award,
  ingredients: Box,
  nutrition: HeartPulse,
  storage: Snowflake,
  packaging: Box,
};

export default function ProductDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const [activeImage, setActiveImage] = useState(0);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);

  const { data: product, loading: productLoading, error: productError, reload: reloadProduct } = useAsync(() => productRepository.getBySlug(slug), [slug]);
  const { data: relatedRaw } = useAsync(() => (product ? productRepository.listRelated(product.id) : Promise.resolve([])), [product?.id]);
  const related = useFilteredRecommendations(relatedRaw, { excludeProductId: product?.id });

  const isWishlisted = useWishlistStore((s) => (product ? s.isWishlisted(product.id) : false));
  const toggleWishlist = useWishlistStore((s) => s.toggle);
  const cartQuantity = useCartStore((s) => (selectedVariantId ? s.quantityForVariant(selectedVariantId) : 0));

  const variant: ProductVariant | undefined = useMemo(() => {
    if (!product) return undefined;
    return product.variants.find((v) => v.id === (selectedVariantId ?? product.defaultVariantId)) ?? product.variants[0];
  }, [product, selectedVariantId]);

  if (!product || !variant) {
    if (productLoading) return <ProductDetailSkeleton />;
    return (
      <View style={styles.container}>
        <EmptyState
          title={productError ? "Couldn't load this product" : 'Product not found'}
          subtitle={productError ? 'Check your connection and try again.' : "This product doesn't exist or is no longer available."}
          ctaLabel={productError ? 'Retry' : undefined}
          onPressCta={productError ? reloadProduct : undefined}
        />
      </View>
    );
  }

  const outOfStock = variant.stockStatus === 'out_of_stock';
  // A product with no real photo yet must still render one fallback
  // slot (Final Release Hardening, Priority 1) — mapping an empty
  // product.images[] would otherwise render zero <Image> elements and
  // collapse the whole hero/gallery area instead of showing the
  // branded "GP" placeholder.
  const galleryImages: (string | null)[] = product.images.length > 0 ? product.images : [null];

  const handleShare = () => {
    Share.share({ message: `Check out ${product.name} on Govind Pansari — ${formatINR(variant.price)}` }).catch(() => {});
  };

  const buyNow = () => {
    if (outOfStock) return;
    if (cartQuantity === 0) useCartStore.getState().addItem(product.id, variant.id, 1);
    router.push('/cart');
  };

  const headTags = (
    <Head>
      <title>{`${product.name} — ${formatINR(variant.price)} | Govind Pansari`}</title>
      <meta name="description" content={`${product.descriptor} Buy ${product.name} online from Govind Pansari, Agra — premium dry fruits, spices & gifting.`} />
      <meta property="og:title" content={product.name} />
      <meta property="og:description" content={product.descriptor} />
      {product.images[0] && <meta property="og:image" content={product.images[0]} />}
      <meta property="og:type" content="product" />
    </Head>
  );

  const infoSectionsContent = (
    <View style={styles.infoSections}>
      {product.infoSections.map((section, i) => (
        <AccordionItem
          key={section.key}
          icon={INFO_ICONS[section.key]}
          title={section.title}
          body={section.body}
          defaultOpen={i === 0}
        />
      ))}
    </View>
  );

  const trustRowContent = (
    <View style={styles.trustRow}>
      <TrustItem icon={Truck} title="Free Delivery" subtitle="On orders above ₹499" />
      <TrustItem icon={Award} title="100% Quality" subtitle="Premium & fresh" />
    </View>
  );

  // Desktop (section 8): large image gallery + thumbnail rail on the
  // left, a sticky buy box on the right — same product/variant/cart
  // state and repository data as mobile, just arranged for a wide
  // viewport instead of stretched mobile scroll chrome.
  if (isWide) {
    return (
      <View style={styles.wideContainer}>
        {headTags}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.wideScrollContent}>
          <Pressable style={styles.wideBackBtn} onPress={() => router.back()}>
            <ArrowLeft size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            <Text style={styles.wideBackText}>Back</Text>
          </Pressable>

          <View style={styles.wideGrid}>
            <View style={styles.wideGallery}>
              <View style={styles.wideMainImageWrap}>
                <AppImage uri={galleryImages[activeImage] ?? galleryImages[0]} style={styles.wideMainImage} contentFit="cover" kind="product" borderRadius={0} />
                {product.badges[0] && (
                  <View style={styles.badgeSlotWide}>
                    <ProductBadgePill kind={product.badges[0]} />
                  </View>
                )}
              </View>
              {product.images.length > 1 && (
                <View style={styles.wideThumbRow}>
                  {product.images.map((img, i) => (
                    <Pressable
                      key={i}
                      onPress={() => setActiveImage(i)}
                      style={[styles.wideThumb, activeImage === i && styles.thumbActive]}
                    >
                      <AppImage uri={img} style={styles.thumbImage} contentFit="cover" kind="product" />
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.wideInfoPanel}>
              <Text style={styles.wideName}>{product.name}</Text>
              <Text style={styles.descriptor}>{product.descriptor}</Text>

              <View style={styles.ratingRow}>
                <Rating value={product.rating} count={product.reviewCount} showCount={false} size={ICON_SIZE.sm} />
                <Text style={styles.reviewCount}>{product.reviewCount.toLocaleString('en-IN')} reviews</Text>
                <View style={styles.wideIconBtn}>
                  <AnimatedWishlistHeart active={isWishlisted} onToggle={() => toggleWishlist(product.id)} bare iconSize={ICON_SIZE.sm} />
                </View>
                <Pressable style={styles.wideIconBtn} onPress={handleShare}>
                  <Share2 size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                </Pressable>
              </View>

              <View style={styles.priceRow}>
                <PriceBlock price={variant.price} mrp={variant.mrp} size="lg" />
                <Chip
                  label={outOfStock ? 'Out of Stock' : variant.stockStatus === 'low_stock' ? `Only ${variant.stockCount} left` : 'In Stock'}
                  tone={outOfStock ? 'warning' : 'success'}
                />
              </View>
              <Text style={styles.taxNote}>Inclusive of all taxes</Text>

              <Text style={styles.sectionLabel}>Select Weight</Text>
              <View style={styles.variantRow}>
                {product.variants.map((v) => {
                  const active = v.id === variant.id;
                  return (
                    <Pressable
                      key={v.id}
                      onPress={() => setSelectedVariantId(v.id)}
                      style={[styles.variantChip, active && styles.variantChipActive]}
                      disabled={v.stockStatus === 'out_of_stock'}
                    >
                      <Text style={[styles.variantLabel, active && styles.variantLabelActive]}>{v.label}</Text>
                      <Text style={[styles.variantPrice, active && styles.variantLabelActive]}>{formatINR(v.price)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.wideActions}>
                <AddToCartControl productId={product.id} variantId={variant.id} size="lg" disabled={outOfStock} imageUri={product.images[activeImage]} />
                <Pressable style={[styles.buyNowBtnWide, { opacity: outOfStock ? 0.5 : 1 }]} onPress={buyNow} disabled={outOfStock}>
                  <Text style={styles.buyNowText}>Buy Now</Text>
                </Pressable>
              </View>

              {trustRowContent}
            </View>
          </View>

          <View style={styles.wideDetailSection}>{infoSectionsContent}</View>

          {related && related.length > 0 && (
            <View style={styles.wideRelatedSection}>
              <ProductRail title="You may also like" products={related} />
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {headTags}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setActiveImage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
          >
            {galleryImages.map((img, i) => (
              <AppImage key={i} uri={img} style={styles.heroImage} contentFit="cover" kind="product" borderRadius={0} />
            ))}
          </ScrollView>

          <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
            <Pressable style={styles.circleButton} onPress={() => router.back()}>
              <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={styles.circleButton}>
                <AnimatedWishlistHeart active={isWishlisted} onToggle={() => toggleWishlist(product.id)} bare iconSize={ICON_SIZE.md} iconColorInactive={colors.textPrimary} />
              </View>
              <Pressable style={styles.circleButton} onPress={handleShare}>
                <Share2 size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
              </Pressable>
            </View>
          </View>

          {product.badges[0] && (
            <View style={styles.badgeSlot}>
              <ProductBadgePill kind={product.badges[0]} />
            </View>
          )}

          {product.images.length > 1 && (
            <View style={styles.thumbRow}>
              {product.images.slice(0, 4).map((img, i) => (
                <Pressable key={i} onPress={() => setActiveImage(i)} style={[styles.thumb, activeImage === i && styles.thumbActive]}>
                  <AppImage uri={img} style={styles.thumbImage} contentFit="cover" kind="product" />
                </Pressable>
              ))}
              <View style={styles.imageCounter}>
                <Text style={styles.imageCounterText}>
                  {activeImage + 1}/{product.images.length}
                </Text>
                <ChevronRight size={12} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              </View>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.descriptor}>{product.descriptor}</Text>

          <View style={styles.ratingRow}>
            <Rating value={product.rating} count={product.reviewCount} showCount={false} size={ICON_SIZE.sm} />
            <Text style={styles.reviewCount}>{product.reviewCount.toLocaleString('en-IN')} reviews</Text>
          </View>

          <View style={styles.priceRow}>
            <PriceBlock price={variant.price} mrp={variant.mrp} size="lg" />
            <Chip
              label={outOfStock ? 'Out of Stock' : variant.stockStatus === 'low_stock' ? `Only ${variant.stockCount} left` : 'In Stock'}
              tone={outOfStock ? 'warning' : 'success'}
            />
          </View>
          <Text style={styles.taxNote}>Inclusive of all taxes</Text>

          <Text style={styles.sectionLabel}>Select Weight</Text>
          <View style={styles.variantRow}>
            {product.variants.map((v) => {
              const active = v.id === variant.id;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => setSelectedVariantId(v.id)}
                  style={[styles.variantChip, active && styles.variantChipActive]}
                  disabled={v.stockStatus === 'out_of_stock'}
                >
                  <Text style={[styles.variantLabel, active && styles.variantLabelActive]}>{v.label}</Text>
                  <Text style={[styles.variantPrice, active && styles.variantLabelActive]}>{formatINR(v.price)}</Text>
                </Pressable>
              );
            })}
          </View>

          {infoSectionsContent}
          {trustRowContent}
        </View>

        {related && related.length > 0 && (
          <View style={{ marginTop: spacing.xl }}>
            <ProductRail title="You may also like" products={related} />
          </View>
        )}
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View>
          <Text style={styles.stickyPrice}>{formatINR(variant.price)}</Text>
          <Text style={styles.stickyWeight}>{variant.label}</Text>
        </View>
        <View style={styles.stickyActions}>
          <AddToCartControl productId={product.id} variantId={variant.id} size="lg" disabled={outOfStock} imageUri={product.images[activeImage]} />
          <Pressable style={[styles.buyNowBtn, { opacity: outOfStock ? 0.5 : 1 }]} onPress={buyNow} disabled={outOfStock}>
            <Text style={styles.buyNowText}>Buy Now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function TrustItem({ icon: Icon, title, subtitle }: { icon: typeof Truck; title: string; subtitle: string }) {
  return (
    <View style={styles.trustItem}>
      <Icon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
      <View>
        <Text style={styles.trustTitle}>{title}</Text>
        <Text style={styles.trustSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  wideContainer: { flex: 1, backgroundColor: colors.background },
  wideScrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl, alignItems: 'center' },
  wideBackBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', width: '100%', maxWidth: 1100, marginBottom: spacing.md },
  wideBackText: { ...textStyles.bodySmall, color: colors.textSecondary },
  wideGrid: { flexDirection: 'row', gap: spacing.xxl, width: '100%', maxWidth: 1100, alignItems: 'flex-start' },
  wideGallery: { flex: 1, position: 'sticky' as never, top: spacing.md },
  wideMainImageWrap: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  wideMainImage: { width: '100%', height: '100%' },
  badgeSlotWide: { position: 'absolute', left: spacing.base, top: spacing.base },
  wideThumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  wideThumb: {
    width: 68,
    height: 68,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  wideInfoPanel: { flex: 1, maxWidth: 460 },
  wideName: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 30, color: colors.textPrimary },
  wideIconBtn: {
    marginLeft: spacing.xs,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.xs,
  },
  wideActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
  buyNowBtnWide: {
    flex: 1,
    height: 52,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wideDetailSection: { width: '100%', maxWidth: 1100, marginTop: spacing.xxl },
  wideRelatedSection: { width: '100%', maxWidth: 1100, marginTop: spacing.xl },
  heroImage: { width: SCREEN_WIDTH, height: SCREEN_WIDTH, backgroundColor: colors.surfaceSunken },
  topBar: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  badgeSlot: { position: 'absolute', left: spacing.base, bottom: 76 },
  thumbRow: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.base,
    right: spacing.base,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  thumbActive: { borderColor: colors.primary },
  thumbImage: { width: '100%', height: '100%' },
  imageCounter: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  imageCounterText: { ...textStyles.caption, color: colors.textPrimary },
  body: { paddingHorizontal: spacing.base, paddingTop: spacing.lg },
  name: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary },
  descriptor: { ...textStyles.body, color: colors.goldDark, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  reviewCount: { ...textStyles.bodySmall, color: colors.textSecondary },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  taxNote: { ...textStyles.caption, color: colors.textMuted, marginTop: 2 },
  sectionLabel: { ...textStyles.cardTitle, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  variantChip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    minWidth: 78,
  },
  variantChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  variantLabel: { ...textStyles.cardTitle, fontSize: 13, color: colors.textPrimary },
  variantLabelActive: { color: colors.primary },
  variantPrice: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  infoSections: { marginTop: spacing.xl },
  trustRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.md },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  trustTitle: { ...textStyles.caption, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  trustSubtitle: { ...textStyles.caption, color: colors.textSecondary, fontSize: 10.5 },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    ...shadows.lg,
  },
  stickyPrice: { ...textStyles.priceLarge, color: colors.textPrimary },
  stickyWeight: { ...textStyles.caption, color: colors.textSecondary },
  stickyActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buyNowBtn: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyNowText: { ...textStyles.button, color: colors.primary, fontSize: 14 },
});
