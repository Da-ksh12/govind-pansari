import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ProfileEditor } from '@/components/account/ProfileEditor';
import { safeNext } from '@/lib/links';
import { serverClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'My profile' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ProfilePage({ searchParams }: Props) {
  const supabase = await serverClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login?next=/account/profile');
  const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', auth.user.id).maybeSingle();
  const raw = (await searchParams).next;
  const next = safeNext(Array.isArray(raw) ? raw[0] : raw, '');
  const needsName = !profile?.full_name?.trim();

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-[clamp(2rem,4.4vw,3.2rem)] font-semibold text-maroon">{needsName ? 'Complete your profile' : 'My profile'}</h1>
      <p className="mt-2 mb-8 text-taupe">{needsName ? 'Tell us your name so we can address your orders properly.' : 'Your name appears on orders and deliveries.'}</p>
      <ProfileEditor
        userId={auth.user.id}
        phone={auth.user.phone ? `+${auth.user.phone}` : ''}
        initialName={profile?.full_name?.trim() ?? ''}
        initialEmail={profile?.email ?? ''}
        next={next || null}
      />
    </div>
  );
}
