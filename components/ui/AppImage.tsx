import React, { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageContentFit } from 'expo-image';
import { ImageOff, type LucideIcon } from 'lucide-react-native';
import { colors, radius } from '../../theme';
import { Skeleton } from './Skeleton';

interface AppImageProps {
  uri?: string | null;
  style: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  borderRadius?: number;
  /**
   * 'product' renders the premium Govind Pansari "GP" mark as the
   * fallback tile (Final Release Hardening pass, section 8 — "a
   * deliberate Govind Pansari fallback", never a bare broken-image
   * icon, for a real product a customer is meant to trust). 'generic'
   * (default, unchanged from before) uses fallbackIcon instead — for
   * non-product content (avatars, proof photos, banners) where a
   * product-branded tile wouldn't make sense.
   */
  kind?: 'product' | 'generic';
  /** Shown in the fallback tile when kind='generic' and there's no uri, or the real image failed to load — pick something that identifies the content type (Package for a product, Store for a store, etc). Defaults to a generic broken-image glyph. */
  fallbackIcon?: LucideIcon;
  fallbackIconSize?: number;
}

/**
 * Shared content-image primitive (redesign section 41; extended to be
 * THE one product-image component app-wide in the Final Release
 * Hardening pass — every product/order/cart thumbnail across the
 * customer app, admin, store-ops, and rider app should go through
 * this instead of a bare <Image>) — "no uri" and "uri present but the
 * fetch failed" always resolve to the same on-brand tile rather than
 * a broken-image icon in one place and a blank beige box in another.
 */
export function AppImage({ uri, style, contentFit = 'cover', borderRadius = radius.sm, kind = 'generic', fallbackIcon: FallbackIcon = ImageOff, fallbackIconSize }: AppImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const flat = StyleSheet.flatten(style) ?? {};
  const boxWidth = typeof flat.width === 'number' ? flat.width : 48;
  const iconSize = fallbackIconSize ?? Math.max(14, Math.min(28, boxWidth * 0.32));

  if (!uri || failed) {
    if (kind === 'product') {
      return (
        <View style={[styles.productFallback, style, { borderRadius }]}>
          <Text style={[styles.productFallbackMark, { fontSize: Math.max(11, Math.min(22, boxWidth * 0.26)) }]}>GP</Text>
        </View>
      );
    }
    return (
      <View style={[styles.fallback, style, { borderRadius }]}>
        <FallbackIcon size={iconSize} color={colors.textMuted} strokeWidth={1.5} />
      </View>
    );
  }

  return (
    <View style={[style, { borderRadius, overflow: 'hidden' }]}>
      {!loaded && <Skeleton width="100%" height={typeof flat.height === 'number' ? flat.height : 48} borderRadius={0} style={styles.skeletonAbsolute} />}
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        transition={150}
        cachePolicy="disk"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  productFallback: { backgroundColor: colors.goldTint, alignItems: 'center', justifyContent: 'center' },
  productFallbackMark: { fontFamily: 'PlayfairDisplay_700Bold', color: colors.goldDark, letterSpacing: 0.5 },
  skeletonAbsolute: { position: 'absolute', top: 0, left: 0 },
});
