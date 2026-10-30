'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_MAX_QUANTITY } from '@/lib/cart/model';
import { defaultVariant, isInStock, type Product } from '@/lib/catalog/model';
import { formatINR } from '@/lib/format';
import { Price } from '../ui/Price';
import { AddToCartButton } from './AddToCartButton';
import { WishlistButton } from './WishlistButton';

/** Choose a pack size and quantity. Price, MRP, SKU and stock all follow the chosen variant; the variant's id is what goes into the cart. */
export function ProductPurchase({ product }: { product: Product }) {
  const [variantId, setVariantId] = useState(() => defaultVariant(product)?.id);
  const [quantity, setQuantity] = useState(1);
  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  if (!variant) return <p className="rounded-2xl bg-sand p-5 text-taupe">This product has no pack sizes on sale right now.</p>;

  const sold = !isInStock(variant);
  const stock =
    variant.stock === 'in_stock' ? { text: 'In stock', cls: 'text-forest' }
    : variant.stock === 'low_stock' ? { text: 'Only a few left', cls: 'text-terracotta' }
    : variant.stock === 'out_of_stock' ? { text: 'Sold out', cls: 'text-danger' }
    : null;

  return (
    <div className="space-y-7">
      <div>
        <Price price={variant.price} mrp={variant.mrp} size="lg" />
        {variant.discountPercent > 0 && <p className="mt-1 text-sm font-semibold text-forest">You save {variant.discountPercent}% ({formatINR(variant.mrp - variant.price)}) on MRP</p>}
        <p className="mt-1 text-xs text-taupe">Delivery charges, if any, are shown at checkout.</p>
      </div>

      <fieldset>
        <legend className="mb-3 text-sm font-bold text-espresso">Pack size</legend>
        <div role="radiogroup" aria-label="Pack size" className="flex flex-wrap gap-3">
          {product.variants.map((v) => {
            const selected = v.id === variant.id;
            const out = !isInStock(v);
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => { setVariantId(v.id); setQuantity(1); }}
                className={`relative min-w-24 rounded-2xl border-2 px-5 py-3 text-left transition ${selected ? 'border-maroon bg-maroon-light' : 'border-line-strong bg-paper hover:border-maroon/50'} ${out ? 'opacity-60' : ''}`}
              >
                <span className="block text-sm font-extrabold text-espresso">{v.label}</span>
                <span className="block text-xs text-taupe">{out ? 'Sold out' : formatINR(v.price)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {stock && <p className={`font-bold ${stock.cls}`}>● {stock.text}</p>}
        <p className="text-taupe">SKU: <span className="font-semibold text-espresso">{variant.sku}</span></p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center rounded-full border-2 border-line-strong bg-paper" role="group" aria-label="Quantity">
          <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Decrease quantity" className="grid h-12 w-12 place-items-center rounded-full text-maroon hover:bg-sand disabled:opacity-35"><Minus size={18} aria-hidden /></button>
          <output className="w-10 text-center text-base font-extrabold tabular-nums" aria-live="polite">{quantity}</output>
          <button type="button" onClick={() => setQuantity((q) => Math.min(DEFAULT_MAX_QUANTITY, q + 1))} disabled={quantity >= DEFAULT_MAX_QUANTITY} aria-label="Increase quantity" className="grid h-12 w-12 place-items-center rounded-full text-maroon hover:bg-sand disabled:opacity-35"><Plus size={18} aria-hidden /></button>
        </div>
        <WishlistButton productId={product.id} name={product.name} className="!h-12 !w-12 border-2 border-line-strong !bg-paper" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <AddToCartButton variantId={variant.id} soldOut={sold} quantity={quantity} image={product.images[0] ?? null} productName={product.name} packLabel={variant.label} className="sm:flex-1" />
        <AddToCartButton mode="buy" variantId={variant.id} soldOut={sold} quantity={quantity} image={product.images[0] ?? null} productName={product.name} packLabel={variant.label} className="sm:flex-1" />
      </div>
      <p className="text-xs text-taupe">Up to {DEFAULT_MAX_QUANTITY} of one pack per order. Stock is confirmed again at checkout.</p>
    </div>
  );
}
