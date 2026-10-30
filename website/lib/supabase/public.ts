import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '../env';

// A cookie-less client for data every visitor may read (catalogue, banners, stores). It never carries a session, so it is safe inside
// unstable_cache and static rendering, where reading cookies would make the page dynamic. Row Level Security still applies: this is the "anon" role.
let client: SupabaseClient | undefined;

export function publicClient(): SupabaseClient {
  client ??= createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
