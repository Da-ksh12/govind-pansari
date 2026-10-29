/**
 * Domain models. Field names/shapes intentionally mirror the planned
 * Supabase tables (see README "Future Supabase Architecture") so the
 * mock repositories in /services can be swapped for real Supabase
 * queries later without reshaping the UI layer.
 */

export type ID = string;

// ---------- Catalogue ----------

export type WeightUnit = 'g' | 'kg';

export interface ProductVariant {
  id: ID;
  productId: ID;
  label: string; // "250 g"
  weightValue: number;
  weightUnit: WeightUnit;
  mrp: number;
  price: number;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  stockCount?: number;
}

export type ProductBadge = 'bestseller' | 'premium' | 'new' | 'organic' | 'limited';

export interface ProductInfoSection {
  key: 'about' | 'quality_origin' | 'ingredients' | 'nutrition' | 'storage' | 'packaging';
  title: string;
  body: string;
}

export interface Review {
  id: ID;
  productId: ID;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface Product {
  id: ID;
  slug: string;
  name: string;
  descriptor: string; // "Crunchy • Whole • Naturally Rich"
  categoryId: ID;
  images: string[];
  badges: ProductBadge[];
  rating: number;
  reviewCount: number;
  variants: ProductVariant[];
  defaultVariantId: ID;
  infoSections: ProductInfoSection[];
  tags: string[]; // for "shop by need" / search matching
  availableInArea: boolean;
  fulfillingStoreId?: ID;
}

export interface Category {
  id: ID;
  slug: string;
  name: string;
  description?: string;
  /** null when the category has no image — render the neutral fallback tile, never a stock photo. */
  heroImage: string | null;
  thumbnail: string | null;
  itemCount: number;
  parentId?: ID;
}

export interface NeedTag {
  id: ID;
  slug: string;
  label: string;
  image: string;
  icon: 'leaf' | 'dumbbell' | 'shield' | 'gift' | 'sparkles' | 'baby' | 'crown' | 'cooking';
}

// ---------- Stores / fulfillment ----------

export interface Store {
  id: ID;
  name: string;
  addressLine: string;
  area: string;
  city: string;
  lat: number;
  lng: number;
  phone: string;
  openTime: string;
  closeTime: string;
  isOpen: boolean;
}

// ---------- Identity ----------

export type UserRole = 'customer' | 'admin' | 'store_manager' | 'rider' | 'staff';

export interface UserProfile {
  id: ID;
  name: string;
  /** False when profiles.full_name is null/empty — `name` above always falls back to a placeholder, so this is the real signal for "still needs to complete profile setup". */
  hasName: boolean;
  phone: string;
  email?: string;
  avatarUrl?: string;
  isPremium: boolean;
  loyaltyPoints: number;
  walletBalance: number;
  memberSince: string;
  role: UserRole;
}

export type AddressLabel = 'home' | 'work' | 'other';

export interface Address {
  id: ID;
  label: AddressLabel;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  lat: number;
  lng: number;
  isDefault: boolean;
  receiverName: string;
  receiverPhone: string;
  /** Structured parts (added with the Google address picker). Older addresses only have line1/line2. */
  houseNo?: string;
  building?: string;
  floor?: string;
  street?: string;
  locality?: string;
  landmark?: string;
  /** The provider's one-line address for the confirmed pin. Display only: delivery uses lat/lng. */
  formattedAddress?: string;
  placeId?: string;
  deliveryInstructions?: string;
  geocodeSource?: 'google' | 'osm' | 'device' | 'manual';
}

// ---------- Cart / wishlist ----------

export interface CartItem {
  id: ID; // cart line id
  productId: ID;
  variantId: ID;
  quantity: number;
  savedForLater?: boolean;
}

export interface WishlistItem {
  id: ID;
  productId: ID;
  addedAt: string;
}

// ---------- Coupons / offers / banners ----------

export interface Coupon {
  id: ID;
  code: string;
  description: string;
  discountType: 'percent' | 'flat';
  discountValue: number;
  maxDiscount?: number;
  minOrderValue: number;
  expiresAt: string;
}

export interface Offer {
  id: ID;
  title: string;
  subtitle: string;
  image: string;
  ctaLabel: string;
  category: 'first_order' | 'combo' | 'festival' | 'free_delivery' | 'premium' | 'gifting';
}

export interface Banner {
  id: ID;
  eyebrow?: string;
  title: string;
  subtitle: string;
  image: string;
  ctaLabel: string;
  deepLink: string; // e.g. "/category/almonds"
  theme: 'dark' | 'light';
}

// ---------- Orders ----------

export type OrderStatus =
  | 'placed'
  | 'confirmed'
  | 'preparing'
  | 'picking'
  | 'packing'
  | 'packed'
  | 'rider_assigned'
  | 'out_for_delivery'
  | 'arriving'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  id: ID;
  productId: ID;
  variantId: ID;
  name: string;
  variantLabel: string;
  image: string;
  /** The product's current photo — shown when `image` (the frozen order-time snapshot) is empty or no longer loads. */
  fallbackImage?: string;
  quantity: number;
  price: number;
  mrp: number;
}

export interface PaymentInfo {
  method: 'upi' | 'card' | 'netbanking' | 'wallet' | 'cod';
  status: 'paid' | 'pending' | 'authorized' | 'failed' | 'refunded' | 'partially_refunded';
  transactionId?: string;
}

export interface Order {
  id: ID;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  items: OrderItem[];
  itemTotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  savings: number;
  address: Address;
  storeId: ID;
  riderId?: ID;
  payment: PaymentInfo;
  etaMinutesMin: number;
  etaMinutesMax: number;
  couponCode?: string;
}

// ---------- Live tracking ----------

export interface LatLng {
  lat: number;
  lng: number;
}

// ---------- Notifications ----------

export type NotificationType =
  | 'order'
  | 'delivery'
  | 'offer'
  | 'payment'
  | 'product'
  | 'promotional'
  | 'system';
