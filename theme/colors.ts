/**
 * Govind Pansari palette — warm ivory, deep burgundy, restrained gold.
 * Derived from the approved visual references. Do not introduce blue,
 * purple, or neon hues; every new color must read as "premium Indian
 * food heritage", not "generic quick-commerce".
 */

export const colors = {
  // Backgrounds
  background: '#FBF3E6',
  backgroundAlt: '#F6EAD8',
  surface: '#FFFFFF',
  surfaceMuted: '#FBF6EF',
  surfaceSunken: '#F3E9D9',

  // Brand
  primary: '#6E1423',
  primaryDark: '#4A0D18',
  primaryDarker: '#33090F',
  primaryLight: '#FBEAEA',
  primaryTint: '#F3E2E0',

  // Gold accent — use sparingly (icons, crowns, dividers, premium badges)
  gold: '#C69A4C',
  goldDark: '#A87F38',
  goldTint: '#F7ECD6',

  // Natural secondary accents (badges, category variety)
  forest: '#355E3B',
  forestTint: '#E4EEE2',
  terracotta: '#B3502C',
  terracottaTint: '#F6E3D6',
  sage: '#6E8A5E',
  sageTint: '#EAF1E4',

  // Text
  textPrimary: '#241512',
  textSecondary: '#7C6F65',
  textMuted: '#A79B8F',
  textOnPrimary: '#FBF3E6',
  textOnDark: '#F6EAD8',

  // Borders / dividers
  border: '#EAE0CE',
  borderStrong: '#DCCBAF',
  divider: '#F0E5D4',

  // Status
  success: '#2F7D4F',
  successTint: '#E7F2E7',
  warning: '#B3502C',
  warningTint: '#F6E3D6',
  error: '#B3202C',
  errorTint: '#FBEAEA',
  info: '#4A6C6F',
  infoTint: '#E6EEEE',

  // Utility
  overlay: 'rgba(36, 21, 18, 0.55)',
  overlaySoft: 'rgba(36, 21, 18, 0.28)',
  skeletonBase: '#EFE3D0',
  skeletonHighlight: '#F8F1E4',
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

/** Deterministic color per product badge kind — keep this small and stable. */
export const badgeColors: Record<
  'bestseller' | 'premium' | 'new' | 'organic' | 'limited',
  { bg: string; text: string; border?: string }
> = {
  bestseller: { bg: colors.primary, text: colors.white },
  premium: { bg: colors.forest, text: colors.white },
  new: { bg: colors.terracotta, text: colors.white },
  organic: { bg: colors.sageTint, text: colors.sage, border: colors.sage },
  limited: { bg: colors.goldTint, text: colors.goldDark, border: colors.gold },
};

export type ColorToken = keyof typeof colors;
