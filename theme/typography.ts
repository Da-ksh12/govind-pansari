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

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 19,
  xl: 22,
  xxl: 26,
  display: 32,
  displayLg: 38,
} as const;

export const lineHeight = {
  xs: 14,
  sm: 18,
  base: 21,
  md: 24,
  lg: 26,
  xl: 28,
  xxl: 32,
  display: 38,
  displayLg: 44,
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
