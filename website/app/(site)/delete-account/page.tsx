import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, type LegalSection } from '@/components/content/LegalPage';
import { contactInfo, dialable } from '@/lib/site';

const DESCRIPTION = 'How to delete your Govind Pansari account and personal data — in the app or on this website — and what we delete and keep.';

export const metadata: Metadata = {
  title: 'Delete your account',
  description: DESCRIPTION,
  alternates: { canonical: '/delete-account' },
  openGraph: { title: 'Delete your Govind Pansari account', description: DESCRIPTION, url: '/delete-account' },
};

// The public "how to delete your account and data" page that Google Play asks for (Play Console → App content → Data safety → account deletion URL).
// It has to be reachable without signing in, name the app, give the steps, and say what is deleted and what is kept and why.
export default function DeleteAccountInfoPage() {
  const contact = contactInfo();
  const sections: LegalSection[] = [
    {
      title: '1. Delete your account in the app',
      body: (
        <ol className="list-decimal space-y-1.5 pl-6">
          <li>Open the <strong>Govind Pansari</strong> app and sign in.</li>
          <li>Go to the <strong>Profile</strong> tab.</li>
          <li>Scroll to the bottom and tap <strong>Delete Account</strong>.</li>
          <li>Read what will be removed, type <strong>DELETE</strong> and confirm.</li>
        </ol>
      ),
    },
    {
      title: '2. Or delete it here on the website',
      body: (
        <>
          <p>You do not need the app. Sign in with the mobile number of your account (we send a one-time code), then confirm on the next page.</p>
          <p>
            <Link href="/account/delete" className="btn btn-primary">Sign in and delete my account</Link>
          </p>
        </>
      ),
    },
    {
      title: '3. What is deleted, and when',
      body: (
        <>
          <p>The moment you confirm, we delete:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>your name, email address and mobile number;</li>
            <li>your saved delivery addresses, including their map positions;</li>
            <li>your cart and wishlist;</li>
            <li>the product reviews you wrote;</li>
            <li>your notifications and notification settings, and the phones registered to receive them.</li>
          </ul>
          <p>Your sign-in is closed at the same time, so you are signed out of the app and the website everywhere. Nothing needs to be approved by us.</p>
        </>
      ),
    },
    {
      title: '4. What we keep, and why',
      body: (
        <>
          <p>Records of orders already placed and paid must be kept because Indian tax, accounting and consumer-protection law require them. We keep, for each past order: the order number, the date, the items and amounts, how it was paid (the method and whether it was paid — never your card, UPI or bank details), the shop it came from and the photo taken by the rider at the door.</p>
          <p>We remove the personal part of those records: the recipient’s name, phone number, street address and exact map position are blanked, leaving only the city, state and pincode. The record is no longer linked to a name or a phone number you can be identified by.</p>
          <p>Records are held only for as long as the law requires, after which they are deleted. Our routine system backups may still hold an older copy for a short time until they are overwritten in their normal cycle. Our payment provider, Razorpay, keeps its own records of online payments under its own privacy policy.</p>
        </>
      ),
    },
    {
      title: '5. Before you delete',
      body: (
        <>
          <p>If an order is still on its way you will be asked to wait until it is delivered or cancelled, because the rider needs the delivery address until then.</p>
          <p>Deletion cannot be undone. If you order from us again with the same mobile number it will be a new account with no history, loyalty points or saved addresses.</p>
          <p>Staff, delivery rider and administrator accounts are managed by the shop. If you work with us and want your account closed, contact us below.</p>
        </>
      ),
    },
    {
      title: '6. Cannot sign in? Ask us to delete it',
      body: (
        <p>
          If you no longer have the mobile number, write to us from the contact details below with your name and the mobile number on the account, and we will delete it for you
          {contact.email ? <> — email <a href={`mailto:${contact.email}`} className="font-semibold text-maroon underline">{contact.email}</a></> : null}
          {contact.phone ? <>{contact.email ? ', ' : ' — '}call <a href={`tel:${dialable(contact.phone)}`} className="font-semibold text-maroon underline">{contact.phone}</a></> : null}
          {contact.email || contact.phone ? ', or use' : ', using'} our <Link href="/contact" className="font-semibold text-maroon underline">Contact</Link> page. We may ask you a question only the account’s owner can answer before we act.
        </p>
      ),
    },
    {
      title: '7. More about your data',
      body: <p>What we collect and why is explained in our <Link href="/privacy" className="font-semibold text-maroon underline">Privacy Policy</Link>.</p>,
    },
  ];
  return (
    <LegalPage
      trail="Delete your account"
      title="Delete your account"
      intro="Govind Pansari (Dry Fruits & Spices, Agra) — how to delete your account and personal data from our app and website."
      updated="November 2026"
      sections={sections}
    />
  );
}
