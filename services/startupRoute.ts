// Where the app goes once it knows who (if anyone) is signed in: after the splash screen, and right after a sign-in. Pure, so
// tests/unit covers every branch.
//
// The rule this exists for: a profile that could not be LOADED is not a profile with NO NAME. The old splash logic read
// `!profile?.hasName` for both, so one failed request on a weak connection sent a returning customer back to the
// "Welcome — enter your name" screen, as if their account had been forgotten.

export type StartupRoute = '/onboarding' | '/login' | '/store' | '/rider' | '/admin' | '/welcome' | '/location' | '/(tabs)';

export type StartupDecision = { kind: 'go'; route: StartupRoute } | { kind: 'profile-unavailable' };

export interface StartupProfile {
  role: string;
  hasName: boolean;
}

/** After the session is known to be valid. `profile` is null only when it could not be loaded. */
export function routeAfterSignIn(profile: StartupProfile | null, hasLocation: boolean): StartupDecision {
  if (!profile) return { kind: 'profile-unavailable' };
  if (profile.role === 'store_manager' || profile.role === 'staff') return { kind: 'go', route: '/store' };
  if (profile.role === 'rider') return { kind: 'go', route: '/rider' };
  if (profile.role === 'admin') return { kind: 'go', route: '/admin' };
  if (!profile.hasName) return { kind: 'go', route: '/welcome' };
  return { kind: 'go', route: hasLocation ? '/(tabs)' : '/location' };
}

export function startupDecision(input: {
  hasOnboarded: boolean;
  authStatus: 'authenticated' | 'unauthenticated';
  profile: StartupProfile | null;
  hasLocation: boolean;
}): StartupDecision {
  if (!input.hasOnboarded) return { kind: 'go', route: '/onboarding' };
  if (input.authStatus !== 'authenticated') return { kind: 'go', route: '/login' };
  return routeAfterSignIn(input.profile, input.hasLocation);
}
