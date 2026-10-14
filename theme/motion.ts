/**
 * Motion system — three tiers only. Pick the tier by what the animation
 * communicates, not by what "feels nice": micro = feedback, standard =
 * continuity, hero = a moment worth savoring (order success, tracking).
 */
export const duration = {
  micro: 180,
  standard: 320,
  hero: 550,
} as const;

export const easing = {
  standard: [0.4, 0, 0.2, 1] as const,
  decelerate: [0, 0, 0.2, 1] as const,
  accelerate: [0.4, 0, 1, 1] as const,
};

/** Reanimated spring presets — pass directly as withSpring's 2nd arg. */
export const spring = {
  snappy: { damping: 18, stiffness: 260, mass: 0.7 },
  gentle: { damping: 20, stiffness: 160, mass: 0.9 },
  bouncy: { damping: 12, stiffness: 200, mass: 0.8 },
  /** Barely-there settle for large/heavy elements (cart bag, sheets). */
  heavy: { damping: 22, stiffness: 140, mass: 1.2 },
} as const;

/**
 * Finer-grained duration scale for the broader motion system (product
 * fly, screen-level moments, cinematic sequences) — duration above
 * stays the original 3-tier scale everything already uses; these are
 * additive aliases for new work, same underlying values where they
 * overlap so nothing drifts inconsistent.
 */
export const motionDuration = {
  instant: 100,
  micro: duration.micro,
  fast: 220,
  normal: duration.standard,
  emphasis: 450,
  cinematic: duration.hero,
} as const;
