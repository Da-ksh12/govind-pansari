import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

// A plain fallback for addresses outside the shop (the shop's own, with its header and footer, is app/(site)/not-found.tsx).
export default function NotFound() {
  return (
    <section className="grid min-h-dvh place-items-center bg-ivory px-6 text-center">
      <div className="max-w-lg">
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-3 font-display text-5xl font-semibold text-maroon">This page isn’t here.</h1>
        <Link href="/" className="btn btn-primary mt-8">Back to home</Link>
      </div>
    </section>
  );
}
