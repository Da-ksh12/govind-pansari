import type { Metadata } from 'next';
import { ShopView } from '@/components/shop/ShopView';
import { PageHeader } from '@/components/ui/PageHeader';
import { parseShopParams } from '@/lib/catalog/query';
import { getCatalogue } from '@/lib/data/catalogue';

export const metadata: Metadata = {
  title: 'Gift Hampers',
  description: 'Gift boxes and curated packs from Govind Pansari, Agra — dry fruits and more, ready to give.',
  alternates: { canonical: '/gift-hampers' },
};
export const revalidate = 60;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function GiftHampersPage({ searchParams }: Props) {
  const query = parseShopParams(await searchParams);
  const { products } = await getCatalogue();
  // everything the owner has filed under Gift Hampers, plus anything tagged "gifting"
  const gifts = products.filter((p) => p.categorySlug === 'gift-hampers' || p.tags.includes('gifting'));
  return (
    <>
      <PageHeader
        trail={[{ label: 'Home', href: '/' }, { label: 'Gift hampers' }]}
        eyebrow="For every occasion"
        title="Gift hampers"
        intro="Boxes and packs chosen for giving — from festive gifting to a thoughtful thank-you."
      />
      <div className="container-x py-10 sm:py-14">
        <ShopView basePath="/gift-hampers" products={gifts} params={{ ...query, tag: '', category: '' }} emptyMessage="New gift hampers are being prepared. Please check back soon." />
      </div>
    </>
  );
}
