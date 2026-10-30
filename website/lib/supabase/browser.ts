'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '../env';

// The browser's Supabase client. @supabase/ssr keeps the session in cookies (not localStorage), so the server renders the same signed-in user
// the browser sees. createBrowserClient is a singleton in the browser; calling this on every render is cheap.
export function browserClient(): SupabaseClient {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
