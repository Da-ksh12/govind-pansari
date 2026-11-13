import { ProductCardSkeleton } from '@/components/commerce/ProductCard';

export default function ShopLoading() {
  return (
    <div className="page-top container-x pb-16" aria-busy="true" aria-label="Loading products">
      <div className="skeleton mb-10 h-14 w-2/3 max-w-lg" />
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}
      </div>
    </div>
  );
}
