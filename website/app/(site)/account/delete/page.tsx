import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DeleteAccount } from '@/components/account/DeleteAccount';
import { serverClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Delete my account' };

export default async function DeleteAccountPage() {
  const supabase = await serverClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/account/delete');

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-[clamp(2rem,4.4vw,3.2rem)] font-semibold text-maroon">Delete my account</h1>
      <p className="mt-2 text-taupe">This removes your account and personal details from Govind Pansari, on this website and in the app.</p>

      <div className="mt-6 space-y-4 rounded-3xl border border-line bg-sand/60 p-6 text-sm leading-relaxed text-espresso/80">
        <div>
          <p className="font-bold text-espresso">What is deleted straight away</p>
          <p>Your name, email and mobile number, saved addresses, cart, wishlist, product reviews, notifications and the phones signed in to your account. Your sign-in is closed, so you will be signed out everywhere.</p>
        </div>
        <div>
          <p className="font-bold text-espresso">What we must keep</p>
          <p>Past orders and payment records stay because Indian tax and consumer law require them. They no longer carry your name, phone number or street address — only the city and pincode, the items, the amounts and the dates.</p>
        </div>
        <div>
          <p className="font-bold text-espresso">Before you start</p>
          <p>An order that is still on its way must be delivered or cancelled first. You can order again later with the same mobile number; it will be a brand-new account.</p>
        </div>
        <p>
          Full details are on our <Link href="/delete-account" className="font-semibold text-maroon underline">account deletion page</Link>.
        </p>
      </div>

      <div className="mt-6">
        <DeleteAccount phone={auth.user.phone ? `+${auth.user.phone}` : ''} />
      </div>
    </div>
  );
}
