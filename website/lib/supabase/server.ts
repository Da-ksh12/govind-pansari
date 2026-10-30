import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { supabaseAnonKey, supabaseUrl } from '../env';

/**
 * A Supabase client that acts as the signed-in visitor (their cookies), for Server Components and Route Handlers. Reading cookies makes the page
 * dynamic, so use it only where the page is about the person (account, orders, checkout), never for public catalogue pages.
 */
export async function serverClient(): Promise<SupabaseClient> {
  const jar = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. proxy.ts refreshes the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}

/** The signed-in user's id, or null. Uses the verified token claims (no network round-trip when the project signs JWTs asymmetrically). */
export async function currentUserId(): Promise<string | null> {
  const supabase = await serverClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === 'string' ? sub : null;
}
