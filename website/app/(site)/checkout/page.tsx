import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow';
import { PageHeader } from '@/components/ui/PageHeader';
import { getDeliveryTerms } from '@/lib/data/storefront';
import { serverClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false, follow: false } };

// proxy.ts has already sent anyone who is not signed in to /login. This page reads the customer's own profile for pre-filling forms only;
// prices, stock and totals are never read here — the checkout asks the server for them.
export default async function CheckoutPage() {
  const supabase = await serverClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/checkout');
  const [{ data: profile }, terms] = await Promise.all([
    supabase.from('profiles').select('full_name, email').eq('id', auth.user.id).maybeSingle(),
    getDeliveryTerms(),
  ]);
  // an account with no name yet (signed in elsewhere) finishes its profile first
  if (!profile?.full_name?.trim()) redirect('/account/profile?next=/checkout');

  return (
    <>
      <PageHeader trail={[{ label: 'Home', href: '/' }, { label: 'Cart', href: '/cart' }, { label: 'Checkout' }]} title="Checkout" />
      <div className="container-x py-10 sm:py-14">
        <CheckoutFlow userId={auth.user.id} name={profile.full_name.trim()} phone={auth.user.phone ?? ''} email={profile.email ?? ''} terms={terms} />
      </div>
    </>
  );
}
