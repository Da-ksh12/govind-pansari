'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Spinner } from '../brand/NutLoader';
import { classifyAuthError } from '@/lib/auth/errors';
import { formatPhoneDisplay, toE164 } from '@/lib/auth/phone';
import { otpSchema, phoneSchema, profileSchema, type OtpForm, type PhoneForm, type ProfileForm } from '@/lib/auth/schemas';
import { browserClient } from '@/lib/supabase/browser';

// Sign in with a mobile number and a 6-digit code, exactly as in the mobile app (same Supabase phone login and SMS), then — only if the account has
// no name yet — ask for it once. The same number gives the same account on the app and the website.
const RESEND_SECONDS = 60;

type Step = 'phone' | 'otp' | 'profile';

function FieldError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-2 text-sm font-semibold text-danger">{message}</p> : null;
}

export function LoginFlow({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const phoneForm = useForm<PhoneForm>({ resolver: zodResolver(phoneSchema), defaultValues: { phone: '' } });
  const otpForm = useForm<OtpForm>({ resolver: zodResolver(otpSchema), defaultValues: { code: '' } });
  const profileForm = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: { fullName: '', email: '' } });

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  const finish = useCallback(() => {
    router.replace(next);
    router.refresh();
  }, [router, next]);

  async function sendCode(values: PhoneForm) {
    setBusy(true);
    setServerError('');
    const { error } = await browserClient().auth.signInWithOtp({ phone: toE164(values.phone) });
    setBusy(false);
    if (error) {
      setServerError(classifyAuthError(error).message);
      return;
    }
    setPhone(values.phone);
    setSeconds(RESEND_SECONDS);
    otpForm.reset({ code: '' });
    setStep('otp');
  }

  async function resend() {
    if (seconds > 0 || busy) return;
    setBusy(true);
    setServerError('');
    const { error } = await browserClient().auth.signInWithOtp({ phone: toE164(phone) });
    setBusy(false);
    if (error) setServerError(classifyAuthError(error).message);
    else setSeconds(RESEND_SECONDS);
  }

  async function verify(values: OtpForm) {
    if (busy) return;
    setBusy(true);
    setServerError('');
    const db = browserClient();
    const { data, error } = await db.auth.verifyOtp({ phone: toE164(phone), token: values.code, type: 'sms' });
    if (error || !data.user) {
      setBusy(false);
      otpForm.reset({ code: '' });
      setServerError(classifyAuthError(error).message);
      return;
    }
    const { data: profile } = await db.from('profiles').select('full_name').eq('id', data.user.id).maybeSingle();
    setBusy(false);
    if (profile?.full_name && String(profile.full_name).trim().length > 0) finish();
    else setStep('profile');
  }

  async function saveProfile(values: ProfileForm) {
    setBusy(true);
    setServerError('');
    const db = browserClient();
    const { data } = await db.auth.getUser();
    if (!data.user) {
      setBusy(false);
      setServerError('Your session ended. Please sign in again.');
      setStep('phone');
      return;
    }
    const patch: Record<string, string> = { full_name: values.fullName };
    if (values.email) patch.email = values.email;
    const { error } = await db.from('profiles').update(patch).eq('id', data.user.id);
    setBusy(false);
    if (error) {
      setServerError("We couldn't save your details. Please try again.");
      return;
    }
    finish();
  }

  // the 6th digit submits by itself; a wrong code clears the box, which re-arms this
  const typedCode = useWatch({ control: otpForm.control, name: 'code' });
  useEffect(() => {
    if (step === 'otp' && /^\d{6}$/.test(typedCode)) void otpForm.handleSubmit(verify)();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only when the typed code (or step) changes, not on every render of verify
  }, [typedCode, step]);
  const otpField = otpForm.register('code', {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    },
  });

  return (
    <div className="w-full max-w-md">
      {step === 'phone' && (
        <form onSubmit={phoneForm.handleSubmit(sendCode)} noValidate className="space-y-6">
          <div>
            <h1 className="font-display text-4xl font-semibold text-maroon">Welcome</h1>
            <p className="mt-2 text-taupe">Sign in or create your account with your mobile number. We’ll text you a 6-digit code.</p>
          </div>
          <div>
            <label htmlFor="phone" className="mb-2 block text-sm font-bold text-espresso">Mobile number</label>
            <div className="flex gap-2">
              <span className="field !w-auto select-none font-bold text-taupe" aria-hidden>+91</span>
              <input id="phone" type="tel" inputMode="numeric" autoComplete="tel-national" autoFocus placeholder="98765 43210" aria-invalid={!!phoneForm.formState.errors.phone} aria-describedby="phone-error" className="field" {...phoneForm.register('phone')} />
            </div>
            <div id="phone-error"><FieldError message={phoneForm.formState.errors.phone?.message} /></div>
          </div>
          {serverError && <p role="alert" className="rounded-xl bg-terracotta-tint p-3 text-sm font-semibold text-danger">{serverError}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full">{busy ? <Spinner /> : null} Send code</button>
          <p className="text-xs leading-relaxed text-taupe">
            By continuing you agree to our <Link href="/terms" className="font-semibold text-maroon underline">Terms of Service</Link> and <Link href="/privacy" className="font-semibold text-maroon underline">Privacy Policy</Link>. Message and data rates may apply.
          </p>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={otpForm.handleSubmit(verify)} noValidate className="space-y-6">
          <button type="button" onClick={() => { setStep('phone'); setServerError(''); }} className="flex items-center gap-1.5 text-sm font-bold text-maroon"><ArrowLeft size={16} aria-hidden /> Change number</button>
          <div>
            <h1 className="font-display text-4xl font-semibold text-maroon">Enter the code</h1>
            <p className="mt-2 text-taupe">We sent a 6-digit code to <strong className="text-espresso">{formatPhoneDisplay(phone)}</strong>.</p>
          </div>
          <div>
            <label htmlFor="code" className="mb-2 block text-sm font-bold text-espresso">Verification code</label>
            <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="••••••" aria-invalid={!!otpForm.formState.errors.code} className="field text-center font-display text-3xl font-semibold tracking-[0.5em]" {...otpField} />
            <FieldError message={otpForm.formState.errors.code?.message} />
          </div>
          {serverError && <p role="alert" className="rounded-xl bg-terracotta-tint p-3 text-sm font-semibold text-danger">{serverError}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full">{busy ? <Spinner /> : null} Verify and continue</button>
          <p className="text-center text-sm text-taupe">
            {seconds > 0 ? <>Resend code in <strong className="tabular-nums">{seconds}s</strong></> : <button type="button" onClick={resend} disabled={busy} className="font-bold text-maroon underline">Resend code</button>}
          </p>
        </form>
      )}

      {step === 'profile' && (
        <form onSubmit={profileForm.handleSubmit(saveProfile)} noValidate className="space-y-6">
          <div>
            <h1 className="font-display text-4xl font-semibold text-maroon">Nice to meet you</h1>
            <p className="mt-2 text-taupe">Tell us your name so we can address your orders properly. You only do this once.</p>
          </div>
          <div>
            <label htmlFor="fullName" className="mb-2 block text-sm font-bold text-espresso">Full name</label>
            <input id="fullName" autoComplete="name" autoFocus aria-invalid={!!profileForm.formState.errors.fullName} className="field" {...profileForm.register('fullName')} />
            <FieldError message={profileForm.formState.errors.fullName?.message} />
          </div>
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-bold text-espresso">Email <span className="font-normal text-taupe">(optional)</span></label>
            <input id="email" type="email" autoComplete="email" aria-invalid={!!profileForm.formState.errors.email} className="field" {...profileForm.register('email')} />
            <FieldError message={profileForm.formState.errors.email?.message} />
          </div>
          {serverError && <p role="alert" className="rounded-xl bg-terracotta-tint p-3 text-sm font-semibold text-danger">{serverError}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full">{busy ? <Spinner /> : null} Continue</button>
        </form>
      )}
    </div>
  );
}
