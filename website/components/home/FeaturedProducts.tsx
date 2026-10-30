import type { Product } from '@/lib/catalog/model';
import { ProductGrid } from '../commerce/ProductCard';
import { Reveal } from '../ui/Reveal';
import { SectionHeading } from '../ui/SectionHeading';

export function FeaturedProducts({ products }: { products: Product[] }) {
  if (products.length === 0) return null;
  return (
    <section className="section-pad container-x" aria-labelledby="best-title">
      <Reveal>
        <SectionHeading
          eyebrow="Most loved"
          title={<span id="best-title">Our bestsellers</span>}
          intro="The packs our customers come back for, week after week."
          link={{ href: '/bestsellers', label: 'View all bestsellers' }}
        />
      </Reveal>
      <Reveal className="mt-12" delay={0.1}>
        <ProductGrid products={products} eagerCount={0} />
      </Reveal>
    </section>
  );
}
