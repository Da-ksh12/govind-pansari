import { Platform } from 'react-native';

/**
 * One switch decides the whole address experience, because Google's terms tie its data to its map: Places and Geocoding
 * results shown on a map must be shown on a GOOGLE map. So when this is true the picker shows a Google map AND address
 * search/reverse-geocoding come from Google; when it is false the picker shows the OpenStreetMap map and OpenStreetMap /
 * on-device geocoding. Never a mix.
 *
 * It is on only when the build says so (EXPO_PUBLIC_ADDRESS_PROVIDER=google, set together with the Google Maps SDK key for
 * Android) and only on Android: the iOS project has no Google Maps SDK configured, so iOS stays on the OpenStreetMap path.
 */
export const GOOGLE_ADDRESS_ENABLED = process.env.EXPO_PUBLIC_ADDRESS_PROVIDER === 'google' && Platform.OS === 'android';
