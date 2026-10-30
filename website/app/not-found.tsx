import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

export default function NotFound() {
  return (
    <section className="page-top container-x grid min-h-[70vh] place-items-center text-center">
      <div className="max-w-lg">
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-3 font-display text-5xl font-semibold text-maroon sm:text-6xl">This shelf is empty.</h1>
        <p className="mt-4 text-taupe">The page you were looking for has moved or never existed. The rest of the shop is still stocked.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn btn-primary">Back to home</Link>
          <Link href="/shop" className="btn btn-ghost">Browse the shop</Link>
        </div>
      </div>
    </section>
  );
}
