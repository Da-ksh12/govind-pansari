// Nothing secret may reach the mobile bundle, the Expo config or the repository.
//
// Server-only secret NAMES must not appear in any client-side code or config, no
// EXPO_PUBLIC_ variable (the only ones Expo ships to the app) may look like a secret,
// and no file in the project may hold a service-role key or an access token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const SECRET_NAMES = [
  'FAST2SMS_API_KEY',
  'FAST2SMS_DLR_TOKEN',
  'SEND_SMS_HOOK_SECRETS',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SERVICE_ROLE_KEY',
];

const CLIENT_DIRS = ['app', 'components', 'hooks', 'store', 'theme', 'types', 'data', 'services', 'plugins', 'constants'];
const CLIENT_FILES = ['app.json', 'eas.json', 'package.json', 'babel.config.js', 'metro.config.js', 'app.config.js', 'app.config.ts'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'android', 'ios', '.cache', '.expo', 'dist', 'build', '.gradle']);
const TEXT_EXT = /\.(tsx?|jsx?|mjs|cjs|json|toml|md|sql|yml|yaml|env|txt|plist|gradle|properties|xml)$/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT_EXT.test(entry.name) || entry.name.startsWith('.env')) out.push(full);
  }
  return out;
}

const read = (file) => {
  try {
    return statSync(file).size > 2_000_000 ? '' : readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const clientFiles = [
  ...CLIENT_DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap((d) => walk(join(ROOT, d))),
  ...CLIENT_FILES.map((f) => join(ROOT, f)).filter(existsSync),
];

test('the client file set is non-empty (the scan is really looking at something)', () => {
  assert.ok(clientFiles.length > 100, `only ${clientFiles.length} client files found`);
});

test('no server-only secret name appears anywhere in client code or Expo config', () => {
  const hits = [];
  for (const file of clientFiles) {
    const text = read(file);
    for (const name of SECRET_NAMES) if (text.includes(name)) hits.push(`${relative(ROOT, file)} mentions ${name}`);
  }
  assert.deepEqual(hits, []);
});

test('no EXPO_PUBLIC_ variable looks like a secret (those are bundled into the app)', () => {
  const offenders = [];
  const candidates = [...clientFiles, join(ROOT, '.env'), join(ROOT, '.env.example')].filter(existsSync);
  for (const file of candidates) {
    for (const match of read(file).matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)) {
      if (/SECRET|SERVICE|PRIVATE|PASSWORD|PASSWD|API_KEY|TOKEN|WEBHOOK/.test(match[0])) offenders.push(`${relative(ROOT, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual([...new Set(offenders)], []);
});

test('no Razorpay Key ID is hard-coded in the app (it is returned by the server per payment)', () => {
  const hits = clientFiles.filter((f) => /rzp_(live|test)_[A-Za-z0-9]{8,}/.test(read(f))).map((f) => relative(ROOT, f));
  assert.deepEqual(hits, []);
});

test('no file in the project holds a service-role key, an access token or a Razorpay/Fast2SMS credential', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const text = read(file);
    const where = relative(ROOT, file).split(sep).join('/');
    if (/sbp_[0-9a-f]{30,}/.test(text)) offenders.push(`${where}: Supabase access token`);
    if (/rzp_(live|test)_[A-Za-z0-9]{8,}[\s'"`]*[:=,]\s*['"`]?[A-Za-z0-9]{16,}/.test(text)) offenders.push(`${where}: Razorpay key id next to a secret`);
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
      try {
        const claims = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
        if (claims.role === 'service_role') offenders.push(`${where}: a service_role JWT`);
      } catch {
        // not a JWT after all
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the mobile app only ever gets the anon key from the environment', () => {
  const env = join(ROOT, '.env');
  if (!existsSync(env)) return; // CI checkouts have no .env
  const names = [...read(env).matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
  const bundled = names.filter((n) => n.startsWith('EXPO_PUBLIC_'));
  assert.deepEqual(bundled.sort(), bundled.filter((n) => ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SENTRY_DSN'].includes(n)).sort());
});

test('the environment documentation names every required secret and contains no real values', () => {
  const docPath = join(ROOT, 'docs', 'production-sms-and-payments.md');
  assert.ok(existsSync(docPath), 'docs/production-sms-and-payments.md is missing');
  const doc = read(docPath);
  for (const name of ['FAST2SMS_API_KEY', 'FAST2SMS_ROUTE', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'SEND_SMS_HOOK_SECRETS']) {
    assert.ok(doc.includes(name), `${name} is not documented`);
  }
  assert.doesNotMatch(doc, /rzp_(live|test)_[A-Za-z0-9]{8,}/);
  assert.doesNotMatch(doc, /sbp_[0-9a-f]{20,}/);
});
