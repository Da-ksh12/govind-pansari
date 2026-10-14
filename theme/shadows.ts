import { Platform } from 'react-native';

/** Warm-tinted, low-opacity shadows — never pure black, never heavy. */
const make = (opacity: number, radius: number, y: number, elevation: number) =>
  Platform.select({
    ios: {
      shadowColor: '#3D2418',
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: y },
    },
    android: { elevation },
    default: {
      shadowColor: '#3D2418',
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: y },
    },
  });

export const shadows = {
  none: {},
  xs: make(0.05, 4, 1, 1),
  sm: make(0.07, 8, 2, 2),
  md: make(0.09, 14, 4, 4),
  lg: make(0.12, 22, 8, 8),
  floating: make(0.16, 28, 10, 12),
} as const;
