import type { Metadata } from 'next';
import { ShopView } from '@/components/shop/ShopView';
import { PageHeader } from '@/components/ui/PageHeader';
import { parseShopParams } from '@/lib/catalog/query';
import { getCatalogue } from '@/lib/data/catalogue';

export const metadata: Metadata = { title: 'Bestsellers', description: 'The Govind Pansari packs customers come back for.', alternates: { canonical: '/bestsellers' } };
export const revalidate = 60;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BestsellersPage({ searchParams }: Props) {
  const raw = await searchParams;
  const query = parseShopParams(raw);
  const { products } = await getCatalogue();
  const best = products.filter((p) => p.badges.includes('bestseller'));
  // the shop's own order (premium first, newest) unless the visitor picks another
  const params = { ...query, tag: '', category: '', sort: raw.sort ? query.sort : ('featured' as const) };
  return (
    <>
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'Bestsellers' }]} eyebrow="Most loved" title="Our bestsellers" intro="The packs our customers come back for, week after week." />
      <div className="container-x py-10 sm:py-14">
        <ShopView basePath="/bestsellers" products={best} params={params} />
      </div>
    </>
  );
}
