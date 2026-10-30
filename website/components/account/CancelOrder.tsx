'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useDialog } from '@/lib/hooks/useDialog';
import { Spinner } from '../brand/NutLoader';
import { browserClient } from '@/lib/supabase/browser';

// The reasons the mobile app offers, so the store sees the same words from both. The server (update_order_status) decides whether this order can
// still be cancelled; the button is only shown while the terms allow it, but a refusal from the server is shown as-is.
const REASONS = ['Ordered by mistake', 'Changed my mind', 'Delivery taking too long', 'Found another option', 'Other'];

export function CancelOrder({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useDialog(open, () => !busy && setOpen(false));

  async function confirm() {
    if (!reason || busy) return;
    setBusy(true);
    setError('');
    const { error: rpcError } = await browserClient().rpc('update_order_status', { p_order_id: orderId, p_new_status: 'cancelled', p_reason: reason });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message && rpcError.message.length < 160 && !/relation|constraint|violates/i.test(rpcError.message) ? rpcError.message : "We couldn't cancel this order. If it is already being packed, please contact us.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm !border-danger !text-danger hover:!bg-danger hover:!text-white">Cancel order</button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[88] grid place-items-center bg-maroon-darker/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && !busy && setOpen(false)}>
            <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby="cancel-title" tabIndex={-1} className="w-full max-w-md rounded-3xl bg-ivory p-6 shadow-lift" initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}>
              <h2 id="cancel-title" className="font-display text-2xl font-semibold text-maroon">Cancel order {orderNumber}?</h2>
              <p className="mt-1 text-sm text-taupe">Tell us why — it helps the shop. This can’t be undone.</p>
              <div role="radiogroup" aria-label="Reason for cancelling" className="mt-5 space-y-2">
                {REASONS.map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold transition ${reason === r ? 'border-maroon bg-maroon-light text-maroon' : 'border-line-strong hover:border-maroon/50'}`}>{r}</button>
                ))}
              </div>
              {error && <p role="alert" className="mt-4 rounded-xl bg-terracotta-tint p-3 text-sm font-semibold text-danger">{error}</p>}
              <div className="mt-6 flex gap-3">
                <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn btn-ghost flex-1">Keep order</button>
                <button type="button" onClick={confirm} disabled={!reason || busy} className="btn btn-primary flex-1">{busy && <Spinner />} Cancel order</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
