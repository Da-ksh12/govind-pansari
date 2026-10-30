'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { useAuth } from './AuthProvider';
import { useToast } from './ToastProvider';

// The wishlist uses the same tables as the mobile app (wishlists / wishlist_items, protected by row-level security so a customer only ever
// sees their own). It needs an account; for a visitor the heart sends them to sign in and brings them back to where they were.
interface WishlistApi {
  ids: ReadonlySet<string>;
  has: (productId: string) => boolean;
  toggle: (productId: string) => Promise<void>;
}

const Ctx = createContext<WishlistApi>({ ids: new Set(), has: () => false, toggle: async () => undefined });
export const useWishlist = (): WishlistApi => useContext(Ctx);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [loaded, setLoaded] = useState<{ userId: string; ids: ReadonlySet<string> } | null>(null);
  const userId = user?.id ?? null;
  // a signed-out visitor (or one whose list has not loaded yet) simply has nothing saved
  const ids = useMemo<ReadonlySet<string>>(() => (loaded && loaded.userId === userId ? loaded.ids : new Set()), [loaded, userId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      const db = browserClient();
      const { data: wishlist } = await db.from('wishlists').select('id').eq('user_id', userId).maybeSingle();
      if (!wishlist) return;
      const { data } = await db.from('wishlist_items').select('product_id').eq('wishlist_id', wishlist.id);
      if (alive) setLoaded({ userId, ids: new Set((data ?? []).map((r) => r.product_id as string)) });
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const toggle = useCallback(async (productId: string) => {
    if (!userId) {
      router.push(`/login?next=${encodeURIComponent(pathname || '/')}`);
      return;
    }
    const wasSaved = ids.has(productId);
    // change the saved set for THIS customer (a list that has not loaded yet counts as empty)
    const change = (save: boolean) =>
      setLoaded((current) => {
        const next = new Set(current && current.userId === userId ? current.ids : []);
        if (save) next.add(productId);
        else next.delete(productId);
        return { userId, ids: next };
      });
    change(!wasSaved);
    try {
      const db = browserClient();
      let { data: wishlist } = await db.from('wishlists').select('id').eq('user_id', userId).maybeSingle();
      if (!wishlist && !wasSaved) {
        const created = await db.from('wishlists').insert({ user_id: userId }).select('id').single();
        if (created.error) throw created.error;
        wishlist = created.data;
      }
      if (!wishlist) return;
      if (wasSaved) {
        const { error } = await db.from('wishlist_items').delete().eq('wishlist_id', wishlist.id).eq('product_id', productId);
        if (error) throw error;
      } else {
        const { error } = await db.from('wishlist_items').insert({ wishlist_id: wishlist.id, product_id: productId });
        if (error && error.code !== '23505') throw error;
        toast.show('Saved to your wishlist.', 'success');
      }
    } catch {
      // undo the optimistic change
      change(wasSaved);
      toast.show("We couldn't update your wishlist. Please try again.", 'error');
    }
  }, [ids, userId, router, pathname, toast]);

  const api = useMemo<WishlistApi>(() => ({ ids, has: (id) => ids.has(id), toggle }), [ids, toggle]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
