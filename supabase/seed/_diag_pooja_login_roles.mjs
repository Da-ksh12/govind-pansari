#!/usr/bin/env node
// Reproduces exactly what storeOpsRepository.getMyStores() does, but
// authenticated as the real Pooja/Shikha accounts via the anon key
// (not service role) — so this exercises RLS exactly as the app does.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

const ACCOUNTS = [
  { name: 'Pooja', email: 'demo.manager2@govindpansari.dev', password: 'GovindDemo123!' },
  { name: 'Shikha', email: 'demo.manager@govindpansari.dev', password: 'GovindDemo123!' },
];

async function main() {
  for (const acc of ACCOUNTS) {
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email: acc.email, password: acc.password });
    if (signInError) {
      console.log(`${acc.name}: SIGN-IN FAILED —`, signInError.message);
      continue;
    }
    console.log(`${acc.name}: signed in as`, signIn.user.id);

    const { data, error } = await client
      .from('store_staff')
      .select('role, is_active, stores(id, name)')
      .eq('is_active', true)
      .eq('user_id', signIn.user.id);
    console.log(`${acc.name}: getMyStores() [FIXED query] ->`, JSON.stringify(data), error ? `ERROR: ${error.message}` : '');

    const { data: prof, error: profErr } = await client.from('profiles').select('id, full_name, role').eq('id', signIn.user.id).single();
    console.log(`${acc.name}: own profile ->`, JSON.stringify(prof), profErr ? `ERROR: ${profErr.message}` : '');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
