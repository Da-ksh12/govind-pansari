import type { TextStyle } from 'react-native';

/**
 * Two-family type system:
 *  - Display (Playfair Display): screen titles, hero/banner headlines,
 *    product-detail names, order-confirmation moments. Used sparingly —
 *    it carries the "heritage" feeling.
 *  - Body (Plus Jakarta Sans): everything functional — cards, nav,
 *    buttons, prices, metadata. Carries the "modern" feeling.
 */

export const fontFamily = {
  displayRegular: 'PlayfairDisplay_500Medium',
  displaySemibold: 'PlayfairDisplay_600SemiBold',
  displayBold: 'PlayfairDisplay_700Bold',

  body: 'PlusJakartaSans_400Regular',
  bodyMedium: 'PlusJakartaSans_500Medium',
  bodySemibold: 'PlusJakartaSans_600SemiBold',
  bodyBold: 'PlusJakartaSans_700Bold',
  bodyExtrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/**
 * Scale tuned for a calmer, more premium read: every tier above `xs` sits
 * 1-2pt below the previous scale, `xs` stays at 11 as the legibility floor
 * (nav labels, captions, badges), and each line height keeps ~1.35-1.4x the
 * size (Plus Jakarta Sans has tall ascenders; tighter clips on Android).
 */
export const fontSize = {
  xs: 11,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  display: 30,
  displayLg: 36,
} as const;

export const lineHeight = {
  xs: 14,
  sm: 17,
  base: 20,
  md: 23,
  lg: 25,
  xl: 27,
  xxl: 30,
  display: 36,
  displayLg: 42,
} as const;

/**
 * Fixed-width digits so a column of stock quantities, prices or
 * financial metrics lines up — without this, most fonts render "1" and
 * "0" at different widths, so numbers in a list visibly wobble out of
 * alignment as they change (an animated stat especially). Spread this
 * into a Text style alongside any of the styles below.
 */
export const tabularNums: { fontVariant: TextStyle['fontVariant'] } = { fontVariant: ['tabular-nums'] };

/** Named text styles — prefer these over ad-hoc font/size combos. */
export const textStyles = {
  screenTitle: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.xxl,
    lineHeight: lineHeight.xxl,
  },
  heroHeadline: {
    fontFamily: fontFamily.displayBold,
    fontSize: fontSize.displayLg,
    lineHeight: lineHeight.displayLg,
  },
  productName: {
    fontFamily: fontFamily.displaySemibold,
    fontSize: fontSize.xl,
    lineHeight: lineHeight.xl,
  },
  sectionTitle: {
    fontFamily: fontFamily.bodyBold,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
  },
  cardTitle: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
  },
  bodySmall: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
  },
  caption: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
  },
  price: {
    fontFamily: fontFamily.bodyExtrabold,
    fontSize: fontSize.lg,
    lineHeight: lineHeight.lg,
  },
  priceLarge: {
    fontFamily: fontFamily.bodyExtrabold,
    fontSize: fontSize.xxl,
    lineHeight: lineHeight.xxl,
  },
  strikePrice: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
  },
  button: {
    fontFamily: fontFamily.bodyBold,
    fontSize: fontSize.base,
    lineHeight: lineHeight.base,
  },
  navLabel: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
  },
} as const;
