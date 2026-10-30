'use client';

import { Heart } from 'lucide-react';
import { useWishlist } from '../providers/WishlistProvider';

export function WishlistButton({ productId, name, className = '' }: { productId: string; name: string; className?: string }) {
  const { has, toggle } = useWishlist();
  const saved = has(productId);
  return (
    <button
      type="button"
      onClick={() => void toggle(productId)}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from wishlist` : `Save ${name} to wishlist`}
      className={`grid h-10 w-10 place-items-center rounded-full bg-ivory/90 text-maroon shadow-soft backdrop-blur transition hover:bg-paper active:scale-90 ${className}`}
    >
      <Heart size={18} aria-hidden fill={saved ? 'currentColor' : 'none'} />
    </button>
  );
}
