import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShopView } from '@/components/shop/ShopView';
import { PageHeader } from '@/components/ui/PageHeader';
import { parseShopParams } from '@/lib/catalog/query';
import { categoryFamilyIds, getCatalogue } from '@/lib/data/catalogue';

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { categories } = await getCatalogue();
  const category = categories.find((c) => c.slug === slug);
  if (!category) return { title: 'Category not found', robots: { index: false } };
  return {
    title: category.name,
    description: category.description || `Shop ${category.name} from Govind Pansari, Agra — ${category.productCount} products, packed fresh and delivered.`,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: category.image ? { images: [{ url: category.image }] } : undefined,
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const query = parseShopParams(await searchParams);
  const { products, categories } = await getCatalogue();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const family = new Set(categoryFamilyIds(categories, category.id));
  const scoped = products.filter((p) => p.categoryId && family.has(p.categoryId));
  const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : undefined;
  const children = categories.filter((c) => c.parentId === category.id);

  return (
    <>
      <PageHeader
        trail={[{ label: 'Home', href: '/' }, { label: 'Shop', href: '/shop' }, ...(parent ? [{ label: parent.name, href: `/category/${parent.slug}` }] : []), { label: category.name }]}
        title={category.name}
        intro={category.description || undefined}
      >
        {children.length > 0 && (
          <ul className="mt-6 flex flex-wrap gap-2.5" aria-label={`${category.name} sub-categories`}>
            {children.map((c) => (
              <li key={c.id}>
                <Link href={`/category/${c.slug}`} className="inline-block rounded-full border border-line-strong bg-ivory px-4 py-2 text-sm font-semibold text-maroon hover:bg-maroon hover:text-ivory">{c.name} · {c.productCount}</Link>
              </li>
            ))}
          </ul>
        )}
      </PageHeader>
      <div className="container-x py-10 sm:py-14">
        <ShopView basePath={`/category/${category.slug}`} products={scoped} params={{ ...query, category: '', tag: '' }} />
      </div>
    </>
  );
}
