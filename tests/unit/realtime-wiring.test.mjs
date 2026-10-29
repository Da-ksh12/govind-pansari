// Static guards for how screens are wired to realtime. They read the source (like admin-ux-wiring.test.mjs) because
// the failure they prevent — a screen that silently stops updating, or a subscription that leaks — shows nothing at
// compile time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
/** Source without comments: a rule about what the code DOES must not trip over a comment explaining why it does not. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

test('only the realtime layer opens Supabase channels: nothing else can leak or duplicate a subscription', () => {
  const offenders = [];
  for (const dir of ['app', 'components', 'hooks', 'store', 'services']) {
    for (const file of walk(dir)) {
      if (file.split(sep).join('/').startsWith('services/realtime/')) continue;
      if (/\.channel\(|removeChannel\(|uniqueChannel|postgres_changes/.test(code(file))) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

test('every watcher a repository returns is what the screens use as their effect cleanup (never dropped)', () => {
  const screens = [
    'app/admin/orders/[id].tsx',
    'app/admin/deliveries/[id].tsx',
    'app/store/inventory.tsx',
    'app/track/[orderId].tsx',
  ];
  for (const file of screens) {
    const src = read(file);
    assert.match(src, /useEffect\(\(\) => \(?[^;]*subscribeTo|return (trackingRepository|storeOpsRepository|adminRepository)\.subscribeTo/s, `${file} subscribes inside an effect and returns the unsubscribe`);
  }
});

test('admin order and delivery detail follow the server live and reconcile on foreground', () => {
  const order = read('app/admin/orders/[id].tsx');
  assert.match(order, /subscribeToAdminOrder\(id,/);
  assert.match(order, /useRefetchOnForeground\(refreshQuietly\)/);
  assert.match(order, /load\(true\)/, 'live refreshes are silent: they do not blank the screen');
  const delivery = read('app/admin/deliveries/[id].tsx');
  assert.match(delivery, /subscribeToAdminDelivery\(id,/);
});

test('customer tracking listens from placement (before any rider exists), not only once a delivery is live', () => {
  const src = read('app/track/[orderId].tsx');
  assert.match(src, /subscribeToOrderTracking\(orderId, refetch\)/);
  // the order-level feed must not be gated on the live phase, which is what froze "Tracking will start soon"
  const effect = src.slice(src.indexOf('subscribeToOrderTracking') - 200, src.indexOf('subscribeToOrderTracking') + 120);
  assert.doesNotMatch(effect, /isLivePhase/);
  assert.match(src, /subscribeToLocation\(tracking\.deliveryId, \(loc\) => setLiveLocation\(loc\), refetch\)/, 'a gap in location pings triggers a re-read');
});

test('the repository scopes detail subscriptions to the one record, never the whole table', () => {
  const src = read('services/repositories/adminRepository.ts');
  const fn = src.slice(src.indexOf('subscribeToAdminOrder('), src.indexOf('subscribeToAdminDeliveries('));
  assert.match(fn, /filter: `id=eq\.\$\{orderId\}`/);
  assert.match(fn, /filter: `order_id=eq\.\$\{orderId\}`/);
  assert.match(fn, /filter: `id=eq\.\$\{assignmentId\}`/);
  const tracking = read('services/repositories/trackingRepository.ts');
  assert.match(tracking, /table: 'rider_locations', event: 'INSERT', filter: `delivery_id=eq\.\$\{deliveryId\}`/);
});

test('rider location is real GPS only: the service sends through the policy and never fabricates a position', () => {
  const src = code('services/location/riderLocationService.ts');
  assert.match(src, /decideFix\(/);
  assert.match(src, /submitLocation\(/);
  assert.doesNotMatch(src, /Math\.random|interpolate|simulate|mock/i);
  // a failed send is dropped, never queued for later: an old position must not arrive dressed as current
  assert.doesNotMatch(src, /queue|retryLater|pending\.push/i);
});

test('background location is not claimed: the rider is told to keep the app open', () => {
  const notice = read('components/rider/LocationSharingNotice.tsx');
  assert.match(notice, /Keep this app open/);
  const service = read('services/location/riderLocationService.ts');
  assert.match(service, /FOREGROUND-ONLY/);
  assert.doesNotMatch(read('app.json'), /ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE_LOCATION/);
});
