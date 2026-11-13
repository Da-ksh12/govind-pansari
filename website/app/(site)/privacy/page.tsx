import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, type LegalSection } from '@/components/content/LegalPage';
import { contactInfo } from '@/lib/site';

export const metadata: Metadata = { title: 'Privacy Policy', description: 'What information Govind Pansari collects on this website, why, and the choices you have.', alternates: { canonical: '/privacy' } };

export default function PrivacyPage() {
  const contact = contactInfo();
  const sections: LegalSection[] = [
    { title: '1. Who we are', body: <p>Govind Pansari (“we”, “us”, “our”) sells dry fruits, spices, tea and gift hampers for delivery in Agra, India, through this website and our mobile app. This policy explains what information we collect, why, and how you can control it. The website and the app use the same account and the same order records.</p> },
    {
      title: '2. Information we collect',
      body: (
        <>
          <p><strong>Account details you give us:</strong> your name, mobile number and, if you choose, your email.</p>
          <p><strong>Delivery details:</strong> the addresses you save, including the map position of each, and the recipient’s name and phone for each address.</p>
          <p><strong>Location:</strong> your device’s location only when you press “Use my location”. The position is used to check whether we deliver there and to fill in your address. We don’t track your location in the background.</p>
          <p><strong>Order data:</strong> what you order, when, how you paid (the method and status — never your card, UPI or bank details), and its status, so we and our store and delivery staff can fulfil it.</p>
        </>
      ),
    },
    { title: '3. How we use your information', body: <p>To create and manage your account and orders; to work out which of our stores can deliver to you and estimate the time; to coordinate delivery riders, including sharing your delivery address and live order status with the rider assigned to your order; to send you order and delivery notifications; and to respond to support requests. We do not sell your personal information, and we do not use it for purposes unrelated to running this service.</p> },
    {
      title: '4. Who we share it with',
      body: (
        <>
          <p><strong>Supabase</strong> hosts our database and sign-in on our behalf.</p>
          <p><strong>Razorpay</strong> processes online payments. You enter card, UPI or bank details on Razorpay’s own payment window; we never see or store them.</p>
          <p><strong>OpenStreetMap (Nominatim)</strong> turns the area or pincode you type into a map position, and a map position into an address. Those searches are sent from our server, not your browser, and don’t include your name or account.</p>
          <p><strong>Delivery riders</strong> see the delivery address and order details for orders assigned to them, and nothing more. <strong>Store staff</strong> see orders placed at their store. We do not share your data with advertisers or data brokers.</p>
        </>
      ),
    },
    {
      title: '5. Cookies and browser storage',
      body: (
        <>
          <p>We use a small cookie to keep you signed in, and your browser’s storage to remember your cart (before you sign in), the delivery area you last checked, and that you have already seen the welcome screen. These are needed to make the website work and are not used for advertising.</p>
          <p>This website does not use advertising or analytics trackers.</p>
        </>
      ),
    },
    { title: '6. Payments', body: <p>Orders can be paid by UPI, card, net banking or wallet through Razorpay, or in cash on delivery. We keep the amount, the method and whether it was paid; we do not store your card, UPI or bank details.</p> },
    { title: '7. Your choices', body: <p>You can edit or delete any saved address, and change your name and email, from <Link href="/account" className="font-semibold text-maroon underline">My account</Link>. You can refuse the location permission in your browser — the website still works with a typed area or pincode. You can ask us for a copy of your data, or to delete your account and associated data, by contacting us below.</p> },
    { title: '8. Data retention', body: <p>We keep your order history so you can view past orders and reorder easily, and because Indian tax and consumer-protection law requires certain transaction records to be retained. If you ask us to delete your account, we delete or anonymise personal information that isn’t legally required to be kept.</p> },
    { title: '9. Children', body: <p>This website is for adults placing grocery and gifting orders and is not directed at children under 18.</p> },
    { title: '10. Changes to this policy', body: <p>We may update this policy as the business changes. We’ll update the “last updated” date when we do.</p> },
    {
      title: '11. Contact us',
      body: <p>For privacy questions or data requests, {contact.email ? <>write to <a href={`mailto:${contact.email}`} className="font-semibold text-maroon underline">{contact.email}</a>, </> : null}{contact.phone ? <>call <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="font-semibold text-maroon underline">{contact.phone}</a>, or </> : null}use our <Link href="/contact" className="font-semibold text-maroon underline">Contact</Link> page.</p>,
    },
  ];
  return <LegalPage trail="Privacy Policy" title="Privacy Policy" updated="October 2026" sections={sections} />;
}
