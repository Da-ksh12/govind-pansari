'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { addLine, cartTotals, itemCount, mergeCarts, parseStoredCart, removeLine, setQuantity, type CartLine } from '@/lib/cart/model';
import type { VariantDetail } from '@/lib/cart/types';
import { useAuth } from './AuthProvider';
import { useToast } from './ToastProvider';

// The cart. A visitor who is not signed in has a cart in this browser (localStorage, variant ids and quantities only — never prices). A signed-in
// customer's cart lives on the server, through the same RPCs the mobile app uses (add_to_cart / set_cart_item_quantity / remove_cart_item), so the
// app and the website show one cart. When someone signs in, the browser cart is folded into their server cart once.
const STORAGE_KEY = 'gp.cart.v1';

export interface CartItem extends CartLine {
  detail: VariantDetail;
  lineTotal: number;
}

interface CartApi {
  lines: CartLine[];
  /** Lines whose product details are loaded. */
  items: CartItem[];
  /** Lines whose variant is no longer sold (removed from the catalogue after being added). */
  unavailable: CartLine[];
  count: number;
  subtotal: number;
  mrpTotal: number;
  savings: number;
  /** True until the cart has been read (browser or server) and its product details fetched. */
  loading: boolean;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  add: (variantId: string, quantity?: number, options?: { openDrawer?: boolean }) => Promise<void>;
  setQty: (variantId: string, quantity: number) => Promise<void>;
  remove: (variantId: string) => Promise<void>;
  /** Re-reads the server cart (after an order is placed or a payment fails the server changes the cart itself). */
  refresh: () => Promise<void>;
  /** Resolves when every cart change the customer has made has reached the server — checkout waits for this before it asks the server for totals. */
  settled: () => Promise<void>;
}

const Ctx = createContext<CartApi | null>(null);
export function useCart(): CartApi {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCart must be used inside <CartProvider>');
  return value;
}

function readLocal(): CartLine[] {
  try {
    return parseStoredCart(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}
function writeLocal(lines: readonly CartLine[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // private mode or storage full: the cart still works for this page view
  }
}

async function readServerCart(): Promise<CartLine[]> {
  const db = browserClient();
  const { data: cart, error } = await db.from('carts').select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!cart) return [];
  const { data, error: itemsError } = await db.from('cart_items').select('product_variant_id, quantity').eq('cart_id', cart.id).order('created_at');
  if (itemsError) throw new Error(itemsError.message);
  return (data ?? []).map((r) => ({ variantId: r.product_variant_id as string, quantity: r.quantity as number }));
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const toast = useToast();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [details, setDetails] = useState<Record<string, VariantDetail>>({});
  const [hydrated, setHydrated] = useState(false);
  // the customer whose SERVER cart has been read into `lines` (null until then)
  const [serverFor, setServerFor] = useState<string | null>(null);
  // the exact set of variant ids the current `details` were fetched for (null = not fetched yet)
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  // When the details request itself failed we know nothing about the lines, so none of them may be called "no longer sold".
  const [detailsFailed, setDetailsFailed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const userId = user?.id ?? null;
  const linesLoaded = hydrated && ready && (userId === null || serverFor === userId);
  const userIdRef = useRef<string | null>(null);
  const linesRef = useRef<CartLine[]>([]);
  // Server writes happen one at a time, in the order the customer made them, so a quick +/+/- never lands out of order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const commit = useCallback((next: CartLine[]) => {
    linesRef.current = next;
    setLines(next);
  }, []);
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(job, job);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  // 1) Start from the browser's cart.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reads the browser's storage once after mount; it does not exist during server rendering */
    commit(readLocal());
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [commit]);

  // 2) Follow sign-in / sign-out.
  useEffect(() => {
    if (!ready) return;
    const previous = userIdRef.current;
    userIdRef.current = userId;
    let cancelled = false;

    if (!userId) {
      if (previous) {
        // Signed out: the account's cart stays on the server; this browser starts empty.
        commit([]);
        writeLocal([]);
      }
      return;
    }

    void enqueue(async () => {
      try {
        const guest = readLocal();
        const server = await readServerCart();
        // Push only what the server does not already hold at the right size; add_to_cart adds quantities, so send the difference.
        const merged = mergeCarts(server, guest);
        for (const line of merged) {
          const have = server.find((s) => s.variantId === line.variantId)?.quantity ?? 0;
          const diff = line.quantity - have;
          if (diff > 0) await browserClient().rpc('add_to_cart', { p_variant_id: line.variantId, p_quantity: diff });
        }
        const truth = guest.length > 0 ? await readServerCart() : server;
        if (cancelled) return;
        commit(truth);
        writeLocal([]);
      } catch {
        if (!cancelled) toast.show("We couldn't load your saved cart. Please refresh the page.", 'error');
      } finally {
        if (!cancelled) setServerFor(userId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, userId, commit, enqueue, toast]);

  // 3) Keep several tabs of the same guest cart in step.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && !userIdRef.current) commit(readLocal());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [commit]);

  // 4) Product details (name, picture, current price) for whatever is in the cart.
  const idKey = useMemo(() => lines.map((l) => l.variantId).sort().join(','), [lines]);
  useEffect(() => {
    if (!linesLoaded || !idKey) return;
    let alive = true; // a newer set of ids supersedes this answer
    fetch(`/api/variants?ids=${encodeURIComponent(idKey)}`)
      .then((response) => {
        if (!response.ok) throw new Error('details unavailable');
        return response.json() as Promise<VariantDetail[]>;
      })
      .then((list) => {
        if (!alive) return;
        setDetails(Object.fromEntries(list.map((d) => [d.variantId, d])));
        setDetailsFailed(false);
        setDetailsFor(idKey);
      })
      .catch(() => {
        // keep what we had; the lines still render from the last known details
        if (!alive) return;
        setDetailsFailed(true);
        setDetailsFor(idKey);
      });
    return () => {
      alive = false;
    };
  }, [idKey, linesLoaded]);
  // an empty cart needs no details; otherwise details are "ready" only for the exact ids they were fetched for (so a just-added item is never
  // mistaken for one that is no longer sold while its details are still on the way)
  const detailsReady = idKey === '' || detailsFor === idKey;
  const detailsLoadedOnce = idKey === '' || detailsFor !== null;

  const persist = useCallback((next: CartLine[]) => {
    commit(next);
    if (!userIdRef.current) writeLocal(next);
  }, [commit]);

  const resync = useCallback(async () => {
    if (!userIdRef.current) return;
    try {
      commit(await readServerCart());
    } catch {
      // leave the optimistic state; the next action or refresh corrects it
    }
  }, [commit]);

  const add = useCallback<CartApi['add']>(async (variantId, quantity = 1, options) => {
    persist(addLine(linesRef.current, variantId, quantity));
    if (options?.openDrawer !== false) setDrawerOpen(true);
    if (!userIdRef.current) return;
    await enqueue(async () => {
      const { error } = await browserClient().rpc('add_to_cart', { p_variant_id: variantId, p_quantity: quantity });
      if (error) {
        toast.show(error.message.length < 160 ? error.message : "We couldn't add that to your cart.", 'error');
        await resync();
      }
    });
  }, [persist, enqueue, toast, resync]);

  const setQty = useCallback<CartApi['setQty']>(async (variantId, quantity) => {
    persist(setQuantity(linesRef.current, variantId, quantity));
    if (!userIdRef.current) return;
    await enqueue(async () => {
      const { error } = quantity <= 0
        ? await browserClient().rpc('remove_cart_item', { p_variant_id: variantId })
        : await browserClient().rpc('set_cart_item_quantity', { p_variant_id: variantId, p_quantity: quantity });
      if (error) {
        toast.show(error.message.length < 160 ? error.message : "We couldn't update your cart.", 'error');
        await resync();
      }
    });
  }, [persist, enqueue, toast, resync]);

  const remove = useCallback<CartApi['remove']>(async (variantId) => {
    persist(removeLine(linesRef.current, variantId));
    if (!userIdRef.current) return;
    await enqueue(async () => {
      const { error } = await browserClient().rpc('remove_cart_item', { p_variant_id: variantId });
      if (error) {
        toast.show("We couldn't remove that item. Please try again.", 'error');
        await resync();
      }
    });
  }, [persist, enqueue, toast, resync]);

  const refresh = useCallback(async () => {
    if (userIdRef.current) await enqueue(resync);
    else commit(readLocal());
  }, [enqueue, resync, commit]);

  const settled = useCallback(async () => {
    await queue.current;
  }, []);

  const value = useMemo<CartApi>(() => {
    const items: CartItem[] = [];
    const unavailable: CartLine[] = [];
    for (const line of lines) {
      const detail = details[line.variantId];
      if (detail) items.push({ ...line, detail, lineTotal: detail.price * line.quantity });
      else if (detailsReady && !detailsFailed) unavailable.push(line);
    }
    const totals = cartTotals(items.map((i) => ({ quantity: i.quantity, price: i.detail.price, mrp: i.detail.mrp })));
    return {
      lines,
      items,
      unavailable,
      count: itemCount(lines),
      ...totals,
      loading: !linesLoaded || !detailsLoadedOnce,
      drawerOpen,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      add,
      setQty,
      remove,
      refresh,
      settled,
    };
  }, [lines, details, detailsReady, detailsLoadedOnce, detailsFailed, linesLoaded, drawerOpen, add, setQty, remove, refresh, settled]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
