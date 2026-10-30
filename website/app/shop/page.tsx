import type { Metadata } from 'next';
import { ShopView } from '@/components/shop/ShopView';
import { PageHeader } from '@/components/ui/PageHeader';
import { parseShopParams } from '@/lib/catalog/query';
import { getCatalogue } from '@/lib/data/catalogue';

export const revalidate = 60;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = parseShopParams(await searchParams);
  // the plain shop page (and its numbered pages) is for search engines; filtered, sorted and searched views are not
  const filtered = !!(params.q || params.category || params.tag || params.minPrice !== null || params.maxPrice !== null || params.inStock || params.sort !== 'featured');
  return {
    title: params.q ? `Search: ${params.q}` : params.page > 1 ? `Shop all products — page ${params.page}` : 'Shop all products',
    description: 'Browse the full Govind Pansari range: dry fruits, nuts, spices, masalas, tea and gift boxes — packed fresh in Agra.',
    alternates: { canonical: params.page > 1 && !filtered ? `/shop?page=${params.page}` : '/shop' },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function ShopPage({ searchParams }: Props) {
  const params = parseShopParams(await searchParams);
  const { products, categories } = await getCatalogue();
  return (
    <>
      <PageHeader
        trail={[{ label: 'Home', href: '/' }, { label: 'Shop' }]}
        title={params.q ? <>Results for “{params.q}”</> : 'The whole shop'}
        intro={params.q ? undefined : 'Dry fruits, spices, tea and gifts — filter by category or price, and add to cart in a tap.'}
      />
      <div className="container-x py-10 sm:py-14">
        <ShopView basePath="/shop" products={products} params={params} categories={categories} />
      </div>
    </>
  );
}
