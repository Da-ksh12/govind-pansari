import type { StockStatus } from '../catalog/model';

/** Everything the cart needs to draw one line. Resolved by /api/variants from the catalogue; never stored in the browser (prices must stay fresh). */
export interface VariantDetail {
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  image: string | null;
  label: string;
  sku: string;
  price: number;
  mrp: number;
  stock: StockStatus;
}
