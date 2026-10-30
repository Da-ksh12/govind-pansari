'use client';

import { ArrowRight, Search, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useDialog } from '@/lib/hooks/useDialog';
import { formatINR } from '@/lib/format';

interface Suggestion {
  products: { slug: string; name: string; image: string | null; category: string | null; price: number }[];
  categories: { name: string; slug: string }[];
}
const EMPTY: Suggestion = { products: [], categories: [] };

/** The search box and its live suggestions. It exists only while the overlay is open, so every opening starts empty. */
function SearchPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const panel = useDialog(true, onClose);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  // the answer for ONE typed query; stale answers for older text are ignored rather than cleared
  const [answer, setAnswer] = useState<{ q: string; data: Suggestion } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  const q = query.trim();
  const searched = q.length >= 2;
  const result = searched && answer?.q === q ? answer.data : EMPTY;
  const failed = searched && failedFor === q;
  const loading = searched && answer?.q !== q && !failed;
  const nothing = searched && answer?.q === q && result.products.length === 0 && result.categories.length === 0;

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('search failed');
        setAnswer({ q, data: (await response.json()) as Suggestion });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setFailedFor(q);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!q) return;
    onClose();
    router.push(`/shop?q=${encodeURIComponent(q)}`);
  }

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-maroon-darker/60 px-3 pt-3 backdrop-blur-sm sm:px-6 sm:pt-20"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Search products"
        tabIndex={-1}
        className="w-full max-w-2xl overflow-hidden rounded-3xl bg-ivory shadow-lift"
        initial={{ y: -24, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -16, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        <form onSubmit={submit} role="search" className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Search size={20} className="shrink-0 text-maroon" aria-hidden />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search almonds, saffron, gift boxes…"
            aria-label="Search products"
            aria-controls={listId}
            className="min-w-0 flex-1 bg-transparent text-lg text-espresso placeholder:text-stone focus:outline-none"
          />
          <button type="button" onClick={onClose} aria-label="Close search" className="rounded-full p-2 text-taupe hover:bg-sand">
            <X size={20} aria-hidden />
          </button>
        </form>

        <div id={listId} className="max-h-[65vh] overflow-y-auto p-3" aria-live="polite">
          {!searched && <p className="px-3 py-6 text-center text-sm text-taupe">Type at least two letters to see products.</p>}
          {loading && <p className="px-3 py-6 text-center text-sm text-taupe">Searching…</p>}
          {failed && <p className="px-3 py-6 text-center text-sm text-danger">Search is not available right now. Please try again in a moment.</p>}
          {nothing && (
            <p className="px-3 py-6 text-center text-sm text-taupe">
              Nothing matches “{q}”. Try a simpler word, or <Link href="/shop" onClick={onClose} className="font-semibold text-maroon underline">browse everything</Link>.
            </p>
          )}

          {result.categories.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-2 pt-1">
              {result.categories.map((c) => (
                <Link key={c.slug} href={`/category/${c.slug}`} onClick={onClose} className="rounded-full border border-line-strong px-3.5 py-1.5 text-sm font-semibold text-maroon hover:bg-maroon hover:text-ivory">
                  {c.name}
                </Link>
              ))}
            </div>
          )}

          <ul>
            {result.products.map((p) => (
              <li key={p.slug}>
                <Link href={`/product/${p.slug}`} onClick={onClose} className="flex items-center gap-4 rounded-2xl p-2.5 hover:bg-sand">
                  <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sand">
                    {p.image && <Image src={p.image} alt="" fill sizes="56px" className="object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-base font-semibold text-espresso">{p.name}</span>
                    {p.category && <span className="block truncate text-xs text-taupe">{p.category}</span>}
                  </span>
                  <span className="text-sm font-semibold text-maroon">from {formatINR(p.price)}</span>
                </Link>
              </li>
            ))}
          </ul>

          {result.products.length > 0 && (
            <Link href={`/shop?q=${encodeURIComponent(q)}`} onClick={onClose} className="mt-1 flex items-center justify-center gap-2 rounded-2xl p-3 text-sm font-bold text-maroon hover:bg-sand">
              See all results <ArrowRight size={16} aria-hidden />
            </Link>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <AnimatePresence>{open && <SearchPanel onClose={onClose} />}</AnimatePresence>;
}
