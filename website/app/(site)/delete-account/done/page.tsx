import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Account deleted', robots: { index: false, follow: false } };

export default function AccountDeletedPage() {
  return (
    <div className="page-top container-x pb-20">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="font-display text-[clamp(2rem,4.4vw,3.2rem)] font-semibold text-maroon">Your account has been deleted</h1>
        <p className="mt-4 leading-relaxed text-espresso/80">
          Your name, mobile number, addresses, cart, wishlist and reviews have been removed, and you have been signed out. Past orders are kept only as the anonymous
          records the law requires. Thank you for shopping with Govind Pansari.
        </p>
        <p className="mt-8"><Link href="/" className="btn btn-primary">Back to the home page</Link></p>
      </div>
    </div>
  );
}
