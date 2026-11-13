'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Spinner } from '../brand/NutLoader';
import { browserClient } from '@/lib/supabase/browser';

/** The confirmation step of account deletion: the customer must type DELETE, then the server removes their data and closes the sign-in. */
export function DeleteAccount({ phone }: { phone: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim() === 'DELETE';

  async function remove() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
      const body = (await res.json().catch(() => null)) as { error?: string; success?: boolean } | null;
      if (!res.ok || !body?.success) {
        setError(body?.error ?? 'We could not delete your account just now. Please try again.');
        setBusy(false);
        return;
      }
      // the account is gone on the server; clear this browser's copy of the session (local only: there is nothing left to tell the server)
      await browserClient().auth.signOut({ scope: 'local' }).catch(() => undefined);
      router.replace('/delete-account/done');
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 rounded-3xl border border-line-strong bg-paper p-6 sm:p-8">
      <p className="text-sm text-espresso/80">
        You are deleting the account for <strong className="text-espresso">{phone || 'this mobile number'}</strong>. This cannot be undone.
      </p>
      <div>
        <label htmlFor="confirm" className="mb-2 block text-sm font-bold text-espresso">Type DELETE to confirm</label>
        <input id="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="field" aria-describedby={error ? 'delete-error' : undefined} />
      </div>
      {error && <p id="delete-error" role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      <button type="button" onClick={remove} disabled={!ready || busy} className="btn text-ivory disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--color-danger)' }}>
        {busy && <Spinner />} Permanently delete my account
      </button>
    </div>
  );
}
