'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Spinner } from '../brand/NutLoader';
import { useToast } from '../providers/ToastProvider';
import { profileSchema, type ProfileForm } from '@/lib/auth/schemas';
import { browserClient } from '@/lib/supabase/browser';

interface Props {
  userId: string;
  phone: string;
  initialName: string;
  initialEmail: string;
  /** Where to go after saving (e.g. back to checkout); null to stay here. */
  next: string | null;
}

export function ProfileEditor({ userId, phone, initialName, initialEmail, next }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const form = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: { fullName: initialName, email: initialEmail } });
  const { register, handleSubmit, formState: { errors } } = form;

  async function save(values: ProfileForm) {
    setSaving(true);
    // Column grants allow a customer to change only their own name, email and picture; the phone number is their sign-in and is not editable here.
    const { error } = await browserClient().from('profiles').update({ full_name: values.fullName, email: values.email || null }).eq('id', userId);
    setSaving(false);
    if (error) return toast.show("We couldn't save your details. Please try again.", 'error');
    toast.show('Profile saved.', 'success');
    if (next) router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(save)} noValidate className="space-y-6 rounded-3xl border border-line-strong bg-paper p-6 sm:p-8">
      <div>
        <label htmlFor="phone" className="mb-2 block text-sm font-bold text-espresso">Mobile number</label>
        <input id="phone" value={phone} readOnly disabled className="field bg-sand text-taupe" />
        <p className="mt-1.5 text-xs text-taupe">This is how you sign in, so it can’t be changed here.</p>
      </div>
      <div>
        <label htmlFor="fullName" className="mb-2 block text-sm font-bold text-espresso">Full name</label>
        <input id="fullName" autoComplete="name" aria-invalid={!!errors.fullName} className="field" {...register('fullName')} />
        {errors.fullName && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{errors.fullName.message}</p>}
      </div>
      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-bold text-espresso">Email <span className="font-normal text-taupe">(optional)</span></label>
        <input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} className="field" {...register('email')} />
        {errors.email && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{errors.email.message}</p>}
      </div>
      <button type="submit" disabled={saving} className="btn btn-primary">{saving && <Spinner />} Save changes</button>
    </form>
  );
}
