'use client';

import { Check, ShoppingBag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../brand/NutLoader';
import { useCart } from '../providers/CartProvider';
import { flyToCart } from '@/lib/fly';

interface Props {
  variantId: string | undefined;
  soldOut?: boolean;
  quantity?: number;
  /** For the flying picture. */
  image?: string | null;
  productName: string;
  packLabel?: string;
  /** "Add to cart" button, a round icon button for cards, or "Buy now" (adds, then goes straight to checkout). */
  mode?: 'cart' | 'icon' | 'buy';
  className?: string;
}

export function AddToCartButton({ variantId, soldOut = false, quantity = 1, image = null, productName, packLabel, mode = 'cart', className = '' }: Props) {
  const cart = useCart();
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const disabled = !variantId || soldOut;
  const spoken = `${productName}${packLabel ? `, ${packLabel}` : ''}`;

  async function onClick() {
    if (!variantId || state === 'busy') return;
    if (mode === 'buy') {
      setState('busy');
      await cart.add(variantId, quantity, { openDrawer: false });
      router.push('/checkout');
      return;
    }
    flyToCart(button.current, image);
    setState('added');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1500);
    await cart.add(variantId, quantity);
  }

  if (mode === 'icon') {
    return (
      <button
        ref={button}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={soldOut ? `${spoken} is sold out` : `Add ${spoken} to cart`}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-maroon text-ivory shadow-soft transition hover:bg-maroon-dark active:scale-90 disabled:bg-line-strong disabled:text-stone disabled:shadow-none ${className}`}
      >
        {state === 'added' ? <Check size={18} aria-hidden /> : <ShoppingBag size={18} aria-hidden />}
      </button>
    );
  }

  const buy = mode === 'buy';
  return (
    <button
      ref={button}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn ${buy ? 'btn-ghost' : 'btn-primary'} ${className}`}
    >
      {state === 'busy' ? <Spinner /> : state === 'added' ? <Check size={18} aria-hidden /> : buy ? null : <ShoppingBag size={18} aria-hidden />}
      <span>{soldOut ? 'Sold out' : buy ? 'Buy now' : state === 'added' ? 'Added' : 'Add to cart'}</span>
    </button>
  );
}
