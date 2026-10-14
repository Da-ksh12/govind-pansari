import { create } from 'zustand';
import { adminRepository, type AdminContext, type AdminPermission } from '../services/repositories/adminRepository';

interface AdminState {
  context: AdminContext | null;
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  hasPermission: (p: AdminPermission) => boolean;
  clearLocal: () => void;
}

/**
 * Client-side mirror of current_admin_context() (section 44) — read
 * once after entering the admin surface so nav/buttons can be shown or
 * hidden without a round trip per item. This is UI convenience only;
 * every actual mutation is still enforced server-side by has_permission()
 * inside each RPC/RLS policy regardless of what this store believes.
 */
export const useAdminStore = create<AdminState>()((set, get) => ({
  context: null,
  loading: false,
  loaded: false,

  load: async () => {
    set({ loading: true });
    try {
      const context = await adminRepository.getContext();
      set({ context, loading: false, loaded: true });
    } catch {
      set({ loading: false, loaded: true });
    }
  },

  hasPermission: (p) => {
    const ctx = get().context;
    return !!ctx && (ctx.isSuperAdmin || ctx.permissions.includes(p));
  },

  clearLocal: () => set({ context: null, loading: false, loaded: false }),
}));
