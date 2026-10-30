import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginFlow } from '@/components/auth/LoginFlow';
import { Seal } from '@/components/brand/Logo';
import { safeNext } from '@/lib/links';
import { currentUserId } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false }, alternates: { canonical: '/login' } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw);
  // someone who is already signed in has nothing to do here
  if (await currentUserId()) redirect(next);

  return (
    <section className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-maroon-darker text-ivory lg:block" aria-hidden>
        <div className="jaali absolute inset-0 opacity-[0.08]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_30%,rgb(122_28_46),transparent_65%)]" />
        <div className="relative flex h-full flex-col items-center justify-center px-12 text-center">
          <Seal size={140} />
          <p className="mt-8 font-display text-5xl leading-tight">A <em className="text-gold">Finer</em> Taste<br />of Nature.</p>
          <p className="eyebrow mt-4 !text-gold">Since 1950 · Agra</p>
        </div>
      </aside>
      <div className="page-top flex items-center justify-center px-5 pb-16 sm:px-10">
        <LoginFlow next={next} />
      </div>
    </section>
  );
}
