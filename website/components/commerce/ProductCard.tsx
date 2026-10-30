import Link from 'next/link';
import { bestDiscount, defaultVariant, isInStock, productInStock, startingPrice, type Product } from '@/lib/catalog/model';
import { ProductImage } from '../ui/ProductImage';
import { Price } from '../ui/Price';
import { AddToCartButton } from './AddToCartButton';
import { WishlistButton } from './WishlistButton';

const BADGE_LABEL = { bestseller: 'Bestseller', premium: 'Premium', new: 'New' } as const;

interface Props {
  product: Product;
  /** First row of a page: load the picture straight away. */
  eager?: boolean;
  sizes?: string;
  /** The title's heading level: 2 on a page whose title is the h1 (shop, category), 3 inside a section that has its own h2. */
  headingLevel?: 2 | 3;
}

export function ProductCard({ product, eager = false, sizes = '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw', headingLevel = 3 }: Props) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  const variant = defaultVariant(product);
  const inStock = productInStock(product);
  const discount = bestDiscount(product);
  const packs = product.variants.map((v) => v.label);
  const varied = new Set(product.variants.map((v) => v.price)).size > 1;
  const href = `/product/${product.slug}`;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-paper shadow-soft transition duration-500 hover:-translate-y-1 hover:shadow-lift">
      {/* the picture is a second way into the same page as the title link below, so it is hidden from keyboards and screen readers */}
      <Link href={href} className="relative block aspect-[4/5] overflow-hidden bg-sand" aria-hidden="true" tabIndex={-1}>
        <ProductImage
          src={product.images[0]}
          alt={product.name}
          sizes={sizes}
          eager={eager}
          className={`transition duration-700 ease-[var(--ease-premium)] group-hover:scale-[1.05] ${inStock ? '' : 'opacity-60 grayscale-[.4]'}`}
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1.5">
          {!inStock && <span className="rounded-full bg-espresso px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wider text-ivory">Sold out</span>}
          {inStock && discount > 0 && <span className="rounded-full bg-gold px-2.5 py-1 text-[0.68rem] font-bold tracking-wide text-maroon-darker">Save {discount}%</span>}
          {inStock && product.badges.slice(0, 1).map((b) => (
            <span key={b} className="rounded-full bg-maroon px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-wider text-ivory">{BADGE_LABEL[b]}</span>
          ))}
        </div>
      </Link>
      <WishlistButton productId={product.id} name={product.name} className="absolute right-3 top-3 z-10" />

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {product.categoryName && <p className="eyebrow text-[0.62rem]">{product.categoryName}</p>}
        <Heading className="font-display text-[1.08rem] font-semibold leading-snug text-espresso">
          <Link href={href} className="after:absolute after:inset-0 after:content-[''] after:z-0 focus-visible:after:rounded-2xl">{product.name}</Link>
        </Heading>
        {packs.length > 0 && <p className="text-xs text-taupe">{packs.slice(0, 3).join(' · ')}{packs.length > 3 ? ` +${packs.length - 3}` : ''}</p>}
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <Price price={startingPrice(product)} mrp={!varied && variant ? variant.mrp : undefined} prefix={varied ? 'From' : undefined} />
          <div className="relative z-10">
            <AddToCartButton
              mode="icon"
              variantId={variant?.id}
              soldOut={!variant || !isInStock(variant)}
              image={product.images[0] ?? null}
              productName={product.name}
              packLabel={variant?.label}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, eagerCount = 4, headingLevel = 3 }: { products: Product[]; eagerCount?: number; headingLevel?: 2 | 3 }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} eager={i < eagerCount} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl bg-paper shadow-soft" aria-hidden>
      <div className="skeleton aspect-[4/5] rounded-none" />
      <div className="space-y-2 p-4">
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton h-5 w-4/5" />
        <div className="skeleton h-4 w-1/2" />
      </div>
    </div>
  );
}
