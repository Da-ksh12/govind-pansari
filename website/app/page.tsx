import type { Metadata } from 'next';
import { BrandStory } from '@/components/home/BrandStory';
import { CategoryShowcase } from '@/components/home/CategoryShowcase';
import { CollectionsRail } from '@/components/home/CollectionsRail';
import { FeaturedProducts } from '@/components/home/FeaturedProducts';
import { Hero } from '@/components/home/Hero';
import { SignatureShowcase } from '@/components/home/SignatureShowcase';
import { TrustStrip } from '@/components/home/TrustStrip';
import { JsonLd } from '@/components/seo/JsonLd';
import { categoryFamilyIds, getCatalogue } from '@/lib/data/catalogue';
import { getDeliveryTerms, getStores } from '@/lib/data/storefront';
import { HERO_PRODUCT_SLUGS, SHOWCASE_PRODUCT_SLUGS, STORY_PRODUCT_SLUG, collectionCards, curatedProducts, homeBestsellers } from '@/lib/collections';
import { BRAND, absoluteUrl } from '@/lib/site';

export const revalidate = 60;

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name} — ${BRAND.tagline} Dry fruits, spices & gifts from Agra` },
  description: BRAND.description,
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  const [catalogue, terms, stores] = await Promise.all([getCatalogue(), getDeliveryTerms(), getStores()]);
  const hero = curatedProducts(catalogue.products, HERO_PRODUCT_SLUGS);
  const dryFruits = catalogue.categories.find((c) => c.slug === 'dry-fruits');
  const best = homeBestsellers(catalogue.products, 8, new Set(dryFruits ? categoryFamilyIds(catalogue.categories, dryFruits.id) : []));
  const collections = collectionCards(catalogue.products);
  const showcase = curatedProducts(catalogue.products, SHOWCASE_PRODUCT_SLUGS).map((p) => ({ slug: p.slug, name: p.name, image: p.images[0] ?? null, category: p.categoryName }));
  const storyImage = (catalogue.products.find((p) => p.slug === STORY_PRODUCT_SLUG) ?? best[0])?.images[0] ?? null;
  const categories = catalogue.categories;

  return (
    <>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: BRAND.name,
          url: absoluteUrl('/'),
          logo: absoluteUrl('/brand/seal.webp'),
          foundingDate: String(BRAND.since),
          address: { '@type': 'PostalAddress', addressLocality: BRAND.city, addressRegion: 'Uttar Pradesh', addressCountry: 'IN' },
        }}
      />
      <Hero
        products={hero.map((p) => ({ slug: p.slug, name: p.name, image: p.images[0] ?? null, category: p.categoryName }))}
        deliveryMinutes={terms?.minutes ?? null}
      />
      <CategoryShowcase categories={categories} />
      <SignatureShowcase items={showcase} />
      <FeaturedProducts products={best} />
      <BrandStory image={storyImage} />
      <CollectionsRail collections={collections} />
      <TrustStrip terms={terms} shops={stores.length} />
    </>
  );
}
