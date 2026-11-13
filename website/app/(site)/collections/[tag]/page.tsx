import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShopView } from '@/components/shop/ShopView';
import { PageHeader } from '@/components/ui/PageHeader';
import { parseShopParams } from '@/lib/catalog/query';
import { collectionBySlug } from '@/lib/collections';
import { getCatalogue } from '@/lib/data/catalogue';

export const revalidate = 60;

type Props = { params: Promise<{ tag: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const def = collectionBySlug((await params).tag);
  if (!def) return { title: 'Collection not found', robots: { index: false } };
  return { title: def.label, description: `${def.blurb} Shop the ${def.label} collection from Govind Pansari, Agra.`, alternates: { canonical: `/collections/${def.slug}` } };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { tag } = await params;
  const def = collectionBySlug(tag);
  if (!def) notFound();
  const query = parseShopParams(await searchParams);
  const { products } = await getCatalogue();
  const scoped = products.filter((p) => p.tags.includes(def.slug));
  return (
    <>
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'Collections', href: '/collections' }, { label: def.label }]} title={def.label} intro={def.blurb} />
      <div className="container-x py-10 sm:py-14">
        <ShopView basePath={`/collections/${def.slug}`} products={scoped} params={{ ...query, tag: '', category: '' }} emptyMessage="This collection has no products at the moment." />
      </div>
    </>
  );
}
