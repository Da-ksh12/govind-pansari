import { AppState } from 'react-native';
import { supabase } from '../supabase/client';
import { createLiveFeed, type RealtimeClientLike } from './liveFeedCore';

/**
 * The app's single Realtime entry point (see liveFeedCore.ts for the guarantees). Repositories call
 * `liveFeed.watch(...)` / `liveFeed.watchRows(...)` instead of opening channels themselves.
 */
export const liveFeed = createLiveFeed(supabase as unknown as RealtimeClientLike);

// Stores that have no screen-level "refetch on foreground" hook ask to be resynced when the app comes back:
// the socket may have been suspended while it was in the background.
let lastAppState = AppState.currentState;
AppState.addEventListener('change', (next) => {
  if (next === 'active' && lastAppState !== 'active') liveFeed.notifyForeground();
  lastAppState = next;
});
