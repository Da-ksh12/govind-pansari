import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderStatus, PaymentMethod, PaymentStatus, StatusHistoryRow } from './timeline';

// The customer's own orders, read with THEIR session (so row-level security decides what they may see). Prices shown are the ones snapshotted on
// the order when it was placed, never today's catalogue prices.

export interface OrderLine {
  id: string;
  productId: string;
  name: string;
  variantLabel: string;
  image: string | null;
  quantity: number;
  unitPrice: number;
  mrp: number;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  etaMinutes: number | null;
  items: OrderLine[];
  payment: { method: PaymentMethod | null; status: PaymentStatus | null };
  address: { name: string; phone: string; text: string };
}

const SELECT =
  'id, order_number, status, placed_at, subtotal, discount, delivery_fee, total, estimated_delivery_minutes, delivery_address, ' +
  'order_items(id, product_id, product_name_snapshot, variant_snapshot, image_snapshot, quantity, unit_price, mrp, products(image)), ' +
  'payments(method, status)';

interface Row {
  id: string; order_number: string; status: OrderStatus; placed_at: string; subtotal: number | string; discount: number | string | null; delivery_fee: number | string; total: number | string;
  estimated_delivery_minutes: number | null;
  delivery_address: { recipient_name?: string; phone?: string; address_line_1?: string; address_line_2?: string | null; landmark?: string | null; city?: string; state?: string; postal_code?: string } | null;
  order_items: { id: string; product_id: string; product_name_snapshot: string; variant_snapshot: string; image_snapshot: string | null; quantity: number; unit_price: number | string; mrp: number | string; products: { image: string | null } | null }[] | null;
  payments: { method: PaymentMethod; status: PaymentStatus }[] | null;
}

export function toOrderView(row: Row): OrderView {
  const a = row.delivery_address ?? {};
  const payment = row.payments?.[0];
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    placedAt: row.placed_at,
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    discount: Number(row.discount ?? 0),
    total: Number(row.total),
    etaMinutes: row.estimated_delivery_minutes,
    items: (row.order_items ?? []).map((i) => ({
      id: i.id,
      productId: i.product_id,
      name: i.product_name_snapshot,
      variantLabel: i.variant_snapshot,
      image: i.image_snapshot || i.products?.image || null,
      quantity: i.quantity,
      unitPrice: Number(i.unit_price),
      mrp: Number(i.mrp),
    })),
    payment: { method: payment?.method ?? null, status: payment?.status ?? null },
    address: {
      name: a.recipient_name ?? '',
      phone: a.phone ?? '',
      text: [a.address_line_1, a.address_line_2, a.landmark ? `Near ${a.landmark}` : null, [a.city, a.state].filter(Boolean).join(', '), a.postal_code].filter(Boolean).join(', '),
    },
  };
}

export async function listMyOrders(db: SupabaseClient): Promise<OrderView[]> {
  const { data, error } = await db.from('orders').select(SELECT).order('placed_at', { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(toOrderView);
}

export async function getMyOrder(db: SupabaseClient, id: string): Promise<{ order: OrderView; history: StatusHistoryRow[] } | null> {
  const { data, error } = await db.from('orders').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: history } = await db.from('order_status_history').select('new_status, changed_at').eq('order_id', id).order('changed_at');
  return { order: toOrderView(data as unknown as Row), history: (history ?? []) as StatusHistoryRow[] };
}
