'use client';

import { MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AddressForm } from './AddressForm';
import { addressOneLine, type SavedAddress } from '@/lib/address';
import { browserClient } from '@/lib/supabase/browser';
import { useToast } from '../providers/ToastProvider';

interface Props {
  userId: string;
  initial: SavedAddress[];
  defaultName: string;
  defaultPhone: string;
}

export function AddressManager({ userId, initial, defaultName, defaultPhone }: Props) {
  const toast = useToast();
  const [addresses, setAddresses] = useState(initial);
  const [adding, setAdding] = useState(initial.length === 0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function makeDefault(id: string) {
    setBusyId(id);
    const { error } = await browserClient().rpc('set_default_address', { p_address_id: id });
    setBusyId(null);
    if (error) return toast.show("We couldn't change your default address.", 'error');
    setAddresses((list) => list.map((a) => ({ ...a, isDefault: a.id === id })));
  }

  async function remove(id: string) {
    setBusyId(id);
    const { error } = await browserClient().from('addresses').delete().eq('id', id);
    setBusyId(null);
    setConfirmId(null);
    if (error) return toast.show("We couldn't delete this address. If it belongs to an order in progress, it can't be removed yet.", 'error');
    setAddresses((list) => list.filter((a) => a.id !== id));
  }

  return (
    <div className="space-y-6">
      {addresses.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-col rounded-2xl border border-line-strong bg-paper p-5">
              <div className="flex items-start gap-3">
                <MapPin size={20} className="mt-0.5 shrink-0 text-maroon" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-extrabold capitalize text-espresso">{a.label}{a.isDefault && <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-gold-dark">Default</span>}</p>
                  <p className="mt-1 text-sm text-espresso/80">{a.receiverName} · {a.receiverPhone}</p>
                  <p className="mt-0.5 text-sm text-taupe">{addressOneLine(a)}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                {!a.isDefault && <button type="button" onClick={() => void makeDefault(a.id)} disabled={busyId === a.id} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-maroon hover:bg-sand"><Star size={14} aria-hidden /> Make default</button>}
                {confirmId === a.id ? (
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    <span className="font-semibold text-danger">Delete this address?</span>
                    <button type="button" onClick={() => void remove(a.id)} disabled={busyId === a.id} className="rounded-full bg-danger px-3 py-1.5 font-bold text-white">Delete</button>
                    <button type="button" onClick={() => setConfirmId(null)} className="rounded-full px-3 py-1.5 font-bold text-taupe hover:bg-sand">Keep</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmId(a.id)} className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-danger hover:bg-terracotta-tint"><Trash2 size={14} aria-hidden /> Delete</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-3xl border border-line-strong bg-paper p-5 sm:p-7">
          <AddressForm
            userId={userId}
            defaultName={defaultName}
            defaultPhone={defaultPhone}
            first={addresses.length === 0}
            onCancel={addresses.length > 0 ? () => setAdding(false) : undefined}
            onSaved={(saved) => {
              setAddresses((list) => [saved, ...list.map((a) => (saved.isDefault ? { ...a, isDefault: false } : a))]);
              setAdding(false);
              toast.show('Address saved.', 'success');
            }}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="btn btn-ghost"><Plus size={18} aria-hidden /> Add a new address</button>
      )}
    </div>
  );
}
