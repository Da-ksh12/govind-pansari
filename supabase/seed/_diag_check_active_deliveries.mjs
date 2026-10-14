#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const DEACTIVATED_RIDER_IDS = [
  '9442fd79-eb6f-4a42-9077-9ff78c6c39d1',
  '425d95e5-3311-49c9-ad2d-1315e922d8b6',
  'abf76e9d-4b59-48fd-8dbf-7232adfb02c2',
  '19c78b5a-7f9b-4097-8d37-fe41586eee79',
  'ad5d48c5-cc69-46f2-b468-1da3d2e6719f',
];

async function main() {
  const { data, error } = await admin
    .from('delivery_assignments')
    .select('id, rider_id, status, order_id')
    .in('rider_id', DEACTIVATED_RIDER_IDS);
  if (error) throw error;
  console.log('Total delivery_assignments rows for now-deactivated riders:', data.length);
  console.table(data.map(d => ({ id: d.id, rider: d.rider_id.slice(0,8), status: d.status })));
}
main().catch((e) => { console.error(e); process.exit(1); });
