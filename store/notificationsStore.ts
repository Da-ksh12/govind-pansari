import { create } from 'zustand';
import { notificationRepository, type AppNotificationRow } from '../services/repositories/notificationRepository';

interface NotificationsState {
  items: AppNotificationRow[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loaded: boolean;
  /** The last notification that arrived while the app was open — the foreground banner (section 34/36) reads and clears this. */
  incoming: AppNotificationRow | null;
  unsubscribeRealtime: (() => void) | null;

  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  startRealtime: (userId: string) => void;
  dismissIncoming: () => void;
  clearLocal: () => void;
}

const PAGE_SIZE = 20;

export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  items: [],
  unreadCount: 0,
  loading: false,
  loadingMore: false,
  hasMore: true,
  loaded: false,
  incoming: null,
  unsubscribeRealtime: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const items = await notificationRepository.list();
      set({ items, loading: false, loaded: true, hasMore: items.length === PAGE_SIZE });
    } catch {
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { items, hasMore, loadingMore } = get();
    if (!hasMore || loadingMore || items.length === 0) return;
    set({ loadingMore: true });
    try {
      const next = await notificationRepository.list(items[items.length - 1].createdAt);
      set({ items: [...items, ...next], loadingMore: false, hasMore: next.length === PAGE_SIZE });
    } catch {
      set({ loadingMore: false });
    }
  },

  refreshUnreadCount: async () => {
    try {
      const unreadCount = await notificationRepository.getUnreadCount();
      set({ unreadCount });
    } catch {
      // A stale badge count is harmless — never surface this as an error.
    }
  },

  markRead: async (id) => {
    const wasUnread = get().items.find((n) => n.id === id)?.readAt == null;
    set((s) => ({ items: s.items.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) }));
    if (wasUnread) set((s) => ({ unreadCount: Math.max(0, s.unreadCount - 1) }));
    try {
      await notificationRepository.markRead(id);
    } catch {
      get().refreshUnreadCount();
    }
  },

  markAllRead: async () => {
    const now = new Date().toISOString();
    set((s) => ({ items: s.items.map((n) => ({ ...n, readAt: n.readAt ?? now })), unreadCount: 0 }));
    try {
      await notificationRepository.markAllRead();
    } catch {
      get().refreshUnreadCount();
    }
  },

  startRealtime: (userId) => {
    get().unsubscribeRealtime?.();
    const unsubscribe = notificationRepository.subscribe(
      userId,
      (row) => {
        set((s) => {
          // A reload (resync) can already have fetched this row: never show or count it twice.
          if (s.items.some((item) => item.id === row.id)) return s;
          return { items: [row, ...s.items], unreadCount: s.unreadCount + 1, incoming: row };
        });
      },
      () => {
        if (get().loaded) get().refresh();
        get().refreshUnreadCount();
      },
    );
    set({ unsubscribeRealtime: unsubscribe });
  },

  dismissIncoming: () => set({ incoming: null }),

  clearLocal: () => {
    get().unsubscribeRealtime?.();
    set({ items: [], unreadCount: 0, loading: false, loadingMore: false, hasMore: true, loaded: false, incoming: null, unsubscribeRealtime: null });
  },
}));
