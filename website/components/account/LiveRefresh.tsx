'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { browserClient } from '@/lib/supabase/browser';

interface Props {
  table: string;
  /** A Realtime filter such as "user_id=eq.<id>" or "id=eq.<id>". Row-level security, not this filter, decides what the customer may see. */
  filter: string;
  /** Re-ask the server this often as a safety net (the live channel can drop on poor connections). */
  fallbackMs?: number;
}

/**
 * Keeps a server-rendered page current without a manual reload: when the database says the customer's order changed, the page asks the server
 * for fresh data. The live subscription is removed when the page closes; a slow refresh and a refresh on returning to the tab cover a dropped
 * connection, so the status is never stuck on a stale value.
 */
export function LiveRefresh({ table, filter, fallbackMs = 30_000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    const db = browserClient();
    let pending: number | undefined;
    const refresh = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => router.refresh(), 250); // several changes at once become one refresh
    };

    const channel = db
      .channel(`live-${table}-${filter}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, refresh)
      .subscribe();

    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, fallbackMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearTimeout(pending);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      void db.removeChannel(channel);
    };
  }, [table, filter, fallbackMs, router]);

  return null;
}
