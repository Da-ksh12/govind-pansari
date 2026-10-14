import { create } from 'zustand';
import { orderRepository } from '../services/repositories/orderRepository';
import type { Order } from '../types/models';

interface OrdersState {
  orders: Order[];
  loading: boolean;
  loaded: boolean;
  error: boolean;
  unsubscribeRealtime: (() => void) | null;
  loadOrders: () => Promise<void>;
  /** Pushes a just-created order in immediately, ahead of the next full reload — used right after checkout so Order Success/history don't wait on a second round trip. */
  addOrder: (order: Order) => void;
  getById: (orderId: string) => Order | undefined;
  cancelOrder: (orderId: string, reason?: string) => Promise<void>;
  /** Live status updates for the whole order history (pre-production hardening, part 14) — called once per sign-in, same as notificationsStore.startRealtime. */
  startRealtime: (userId: string) => void;
  /** Local-only reset on logout — never touches server data. */
  clearLocal: () => void;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  loading: false,
  loaded: false,
  error: false,
  unsubscribeRealtime: null,

  loadOrders: async () => {
    set({ loading: true, error: false });
    try {
      const orders = await orderRepository.list();
      set({ orders, loading: false, loaded: true, error: false });
    } catch {
      // Leaves `orders`/`loaded` as they were — a failed refresh (e.g.
      // realtime-triggered) shouldn't blank out an already-loaded list,
      // but the screen still needs to know this attempt failed rather
      // than reading a failed first load as "genuinely no orders".
      set({ loading: false, error: true });
    }
  },

  addOrder: (order) =>
    set((state) => ({ orders: [order, ...state.orders.filter((o) => o.id !== order.id)] })),

  getById: (orderId) => get().orders.find((o) => o.id === orderId),

  cancelOrder: async (orderId, reason) => {
    await orderRepository.cancel(orderId, reason);
    set((state) => ({
      orders: state.orders.map((o) => (o.id === orderId ? { ...o, status: 'cancelled' } : o)),
    }));
  },

  startRealtime: (userId) => {
    get().unsubscribeRealtime?.();
    const unsubscribe = orderRepository.subscribeToMyOrders(userId, () => get().loadOrders());
    set({ unsubscribeRealtime: unsubscribe });
  },

  clearLocal: () => {
    get().unsubscribeRealtime?.();
    set({ orders: [], loading: false, loaded: false, error: false, unsubscribeRealtime: null });
  },
}));
