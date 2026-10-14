import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in the client-safe values (never the service role key).',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

let channelCounter = 0;

/**
 * Every `subscribeToX(id, onChange)` repository function is called
 * independently from however many screens happen to mount at once —
 * e.g. store-ops' Dashboard, Orders list, and Order detail all
 * subscribe to the same store's activity concurrently, since
 * expo-router's tab/stack navigators keep previous screens mounted
 * rather than tearing them down on navigation. `supabase.channel(topic)`
 * returns the SAME channel object for a repeated topic string, so a
 * second caller's `.on(...)` after the first has already `.subscribe()`d
 * throws ("cannot add postgres_changes callbacks... after subscribe()")
 * — a real crash this app hit in production. Suffixing every channel
 * name with a call-local counter guarantees each subscriber gets its
 * own channel, regardless of how many share the same base topic.
 */
export function uniqueChannel(topic: string) {
  channelCounter += 1;
  return supabase.channel(`${topic}-${channelCounter}`);
}
