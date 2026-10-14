export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 48,
  massive: 64,
} as const;

/** Minimum comfortable touch target (Apple HIG / Material both land near this). */
export const touchTarget = 44;

export const screenPadding = spacing.base;
