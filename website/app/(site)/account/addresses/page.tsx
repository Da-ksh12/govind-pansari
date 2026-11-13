import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AddressManager } from '@/components/account/AddressManager';
import { toSavedAddress } from '@/lib/address';
import { serverClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'My addresses' };

export default async function AddressesPage() {
  const supabase = await serverClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/account/addresses');
  const [{ data: rows }, { data: profile }] = await Promise.all([
    supabase.from('addresses').select('*').eq('user_id', auth.user.id).order('is_default', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('profiles').select('full_name').eq('id', auth.user.id).maybeSingle(),
  ]);

  return (
    <div>
      <h1 className="font-display text-[clamp(2rem,4.4vw,3.2rem)] font-semibold text-maroon">My addresses</h1>
      <p className="mt-2 mb-8 text-taupe">Where we deliver. Whether an address is inside our delivery area is checked again when you order.</p>
      <AddressManager
        userId={auth.user.id}
        initial={(rows ?? []).map(toSavedAddress)}
        defaultName={profile?.full_name?.trim() ?? ''}
        defaultPhone={(auth.user.phone ?? '').replace(/\D/g, '').replace(/^91/, '')}
      />
    </div>
  );
}
