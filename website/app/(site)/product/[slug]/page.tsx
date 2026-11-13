import { Star } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DeliveryCheck } from '@/components/commerce/DeliveryCheck';
import { ProductGallery } from '@/components/commerce/ProductGallery';
import { ProductGrid } from '@/components/commerce/ProductCard';
import { ProductPurchase } from '@/components/commerce/ProductPurchase';
import { JsonLd } from '@/components/seo/JsonLd';
import { Breadcrumbs } from '@/components/ui/PageHeader';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { productInStock, priceRange, type Product } from '@/lib/catalog/model';
import { getCatalogue } from '@/lib/data/catalogue';
import { getDeliveryTerms } from '@/lib/data/storefront';
import { absoluteUrl, BRAND } from '@/lib/site';

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

// Product pages are built ahead of time from the live catalogue and refreshed every minute; a product added later is rendered on its first visit.
export async function generateStaticParams() {
  try {
    return (await getCatalogue()).products.map((p) => ({ slug: p.slug }));
  } catch {
    return []; // the catalogue could not be read at build time: every product is then rendered on first visit instead
  }
}

const plain = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = (await getCatalogue()).products.find((p) => p.slug === slug);
  if (!product) return { title: 'Product not found', robots: { index: false } };
  const description = plain(product.shortDescription || product.description || `Buy ${product.name} online from ${BRAND.name}, Agra.`, 160);
  return {
    title: product.name,
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: { type: 'website', title: product.name, description, images: product.images[0] ? [{ url: product.images[0] }] : undefined },
  };
}

function relatedProducts(product: Product, all: readonly Product[]): Product[] {
  const same = all.filter((p) => p.id !== product.id && product.categoryId && p.categoryId === product.categoryId && p.images.length > 0);
  const pool = same.length >= 4 ? same : [...same, ...all.filter((p) => p.id !== product.id && !same.includes(p) && p.badges.includes('bestseller') && p.images.length > 0)];
  return pool.sort((a, b) => Number(productInStock(b)) - Number(productInStock(a))).slice(0, 4);
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [{ products, stockKnown }, terms] = await Promise.all([getCatalogue(), getDeliveryTerms()]);
  const product = products.find((p) => p.slug === slug);
  if (!product) notFound();

  const range = priceRange(product);
  const related = relatedProducts(product, products);
  const description = product.description || product.shortDescription;

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          ...(description ? { description } : {}),
          ...(product.images.length ? { image: product.images } : {}),
          ...(product.categoryName ? { category: product.categoryName } : {}),
          brand: { '@type': 'Brand', name: BRAND.name },
          sku: product.variants[0]?.sku,
          ...(product.reviewCount > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.reviewCount } } : {}),
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'INR',
            lowPrice: range.min,
            highPrice: range.max,
            offerCount: product.variants.length,
            url: absoluteUrl(`/product/${product.slug}`),
            // availability is stated only when the stock view could actually be read
            ...(stockKnown ? { availability: productInStock(product) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } : {}),
          },
        }}
      />
      <div className="page-top container-x pb-8">
        <Breadcrumbs
          trail={[
            { label: 'Home', href: '/' },
            { label: 'Shop', href: '/shop' },
            ...(product.categorySlug && product.categoryName ? [{ label: product.categoryName, href: `/category/${product.categorySlug}` }] : []),
            { label: product.name },
          ]}
        />
        <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <ProductGallery images={product.images} name={product.name} />
          </div>
          <div className="space-y-8">
            <div>
              {product.categoryName && <p className="eyebrow">{product.categoryName}</p>}
              <h1 className="mt-2 font-display text-[clamp(2rem,4.4vw,3.2rem)] font-semibold leading-[1.08] text-maroon">{product.name}</h1>
              {product.reviewCount > 0 && (
                <p className="mt-3 flex items-center gap-2 text-sm text-taupe">
                  <Star size={18} className="fill-gold text-gold" aria-hidden />
                  <span className="font-bold text-espresso">{product.rating.toFixed(1)}</span>
                  <span>({product.reviewCount} {product.reviewCount === 1 ? 'review' : 'reviews'})</span>
                </p>
              )}
              {product.shortDescription && <p className="mt-4 text-lg leading-relaxed text-espresso/80">{product.shortDescription}</p>}
            </div>
            <ProductPurchase product={product} />
            <DeliveryCheck freeDeliveryAbove={terms?.freeDeliveryAbove ?? null} />
            {description && description !== product.shortDescription && (
              <section aria-labelledby="about-product">
                <h2 id="about-product" className="font-display text-2xl font-semibold text-maroon">About this product</h2>
                <div className="mt-3 space-y-3 whitespace-pre-line leading-relaxed text-espresso/80">{description}</div>
              </section>
            )}
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="section-pad container-x" aria-labelledby="related-title">
          <SectionHeading eyebrow="Keep browsing" title={<span id="related-title">You may also like</span>} link={product.categorySlug ? { href: `/category/${product.categorySlug}`, label: `More in ${product.categoryName}` } : undefined} />
          <div className="mt-10"><ProductGrid products={related} eagerCount={0} /></div>
        </section>
      )}
    </>
  );
}
