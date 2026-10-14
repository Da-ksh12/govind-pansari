#!/usr/bin/env node
// Real end-to-end login check, one per role, via the exact same paths
// the app itself uses — not just checking confirmed_at timestamps.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

const OTP_CHECKS = [
  { label: 'Ravi (rider)', phone: '+919000001105' },
  { label: 'Pooja (manager)', phone: '+919000000205' },
  { label: 'Test Admin', phone: '+919000000301' },
  { label: 'Demo Customer 01', phone: '+919000001001' },
];

const PASSWORD_CHECKS = [
  { label: 'Ravi (rider)', email: 'demo.rider05.qa@govindpansari.dev', password: 'GovindDemo123!' },
  { label: 'Pooja (manager)', email: 'demo.manager2@govindpansari.dev', password: 'GovindDemo123!' },
];

async function main() {
  console.log('--- Phone OTP login (code 123456) ---');
  for (const c of OTP_CHECKS) {
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: otpError } = await client.auth.signInWithOtp({ phone: c.phone });
    if (otpError) {
      console.log(`${c.label} (${c.phone}): OTP REQUEST FAILED — ${otpError.message}`);
      continue;
    }
    const { data, error: verifyError } = await client.auth.verifyOtp({ phone: c.phone, token: '123456', type: 'sms' });
    console.log(`${c.label} (${c.phone}):`, verifyError ? `VERIFY FAILED — ${verifyError.message}` : `OK, signed in as ${data.user.id}`);
  }

  console.log('\n--- Email + password login (Team Sign In screen) ---');
  for (const c of PASSWORD_CHECKS) {
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({ email: c.email, password: c.password });
    console.log(`${c.label} (${c.email}):`, error ? `FAILED — ${error.message}` : `OK, signed in as ${data.user.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
