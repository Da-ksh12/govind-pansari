import { create } from 'zustand';

export interface ToastPayload {
  id: number;
  message: string;
  variant: 'success' | 'error' | 'info';
}

interface UIState {
  toast: ToastPayload | null;
  showToast: (message: string, variant?: ToastPayload['variant']) => void;
  dismissToast: () => void;
}

let toastSeq = 0;

export const useUIStore = create<UIState>((set) => ({
  toast: null,
  showToast: (message, variant = 'info') =>
    set({ toast: { id: ++toastSeq, message, variant } }),
  dismissToast: () => set({ toast: null }),
}));
