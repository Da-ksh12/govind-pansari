import { router } from 'expo-router';

// app/admin/** is new this phase — .expo/types/router.d.ts needs a
// local `expo start` (network access) to regenerate and include these
// routes in the typed-routes registry. Real, valid routes; same
// workaround already used for app/store/**/app/rider/**.
export function pushAdmin(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router.push(path as any);
}
export function replaceAdmin(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  router.replace(path as any);
}
