'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest lets the owner find this exact failure in the server logs; the visitor only sees the friendly message.
    console.error('Page error', error.digest ?? '', error.message);
  }, [error]);

  return (
    <section className="page-top container-x grid min-h-[70vh] place-items-center text-center">
      <div className="max-w-lg">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-3 font-display text-4xl font-semibold text-maroon sm:text-5xl">We couldn’t load this page.</h1>
        <p className="mt-4 text-taupe">It’s on our side, not yours. Please try again — if it keeps happening, come back in a few minutes.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">Try again</button>
          <Link href="/" className="btn btn-ghost">Back to home</Link>
        </div>
      </div>
    </section>
  );
}
