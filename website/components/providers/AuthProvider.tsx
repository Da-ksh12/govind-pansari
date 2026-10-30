'use client';

import type { User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { browserClient } from '@/lib/supabase/browser';

interface AuthApi {
  user: User | null;
  /** False until the browser has read its session once; use it to avoid flashing "Sign in" at someone who is already signed in. */
  ready: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthApi>({ user: null, ready: false, signOut: async () => undefined });
export const useAuth = (): AuthApi => useContext(Ctx);

// Auth state lives in the browser only, so catalogue pages stay statically cacheable (reading cookies on the server would make every page
// dynamic). Pages that are about the person (/account, /checkout) are guarded on the server by proxy.ts and read their own cookies.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const db = browserClient();
    let alive = true;
    void db.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, session) => {
      // Only state is set in here; any further Supabase call is made from effects, never inside this callback (it would deadlock the client).
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await browserClient().auth.signOut();
  }, []);

  const api = useMemo(() => ({ user, ready, signOut }), [user, ready, signOut]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
