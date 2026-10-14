// Phase 10 push delivery worker (section 7/8/17/18/19). Invoked on a
// schedule by pg_cron (see 20260826000039_phase10_push_worker.sql) —
// never synchronously from a business transaction, so a slow or
// unreachable push provider can never delay checkout/order-creation/
// delivery-completion (section 17). Provider credentials never leave
// this server-side function; the mobile app only ever talks to
// Supabase, never to Expo's push API directly (section 7/43).
//
// Every database interaction here is a normal typed RPC call — never
// a raw SQL string built by this function — the same PostgREST call
// shape the mobile app itself uses, just authenticated as service_role
// instead of a signed-in user.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// to every Edge Function — no extra secret configuration needed for
// the default Expo Push Service provider (it takes no API key at all).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 100; // Expo's own per-request cap

// Rider "New Delivery" alert (and its close relatives) get a dedicated
// Android channel + custom sound, distinct from the shared 'urgent'
// channel every other high-priority notification (new customer order
// to store staff, admin alerts, etc.) still uses — a rider missing an
// assignment because it blended into generic "urgent" noise is the
// exact failure mode this exists to prevent. get_pending_push_deliveries()
// already merges the notification's event_type into `data.eventType`.
const RIDER_DELIVERY_EVENT_TYPES = new Set([
  'delivery_assigned',
  'delivery_reminder',
  'delivery_reassigned',
  'delivery_exception',
]);
const RIDER_DELIVERY_SOUND = 'rider_delivery_alert.wav';

interface PendingDelivery {
  id: string;
  device_id: string;
  attempt_count: number;
  device_token: string;
  platform: 'ios' | 'android';
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

function backoffSeconds(attemptCount: number): number {
  // section 18: exponential backoff, capped — 30s, 60s, 120s, 240s, then stays at 240s.
  return Math.min(30 * 2 ** attemptCount, 240);
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req) => {
  try {
    // Meant to be invoked only by invoke_push_worker() via pg_cron,
    // authenticated as service_role (see 20260826000039). With no
    // check here, any caller holding just the app's public anon key
    // could invoke this directly and trigger the push batch on
    // demand — not a data leak, but unauthorized use of Expo push
    // quota. Found via security audit.
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
      return new Response(JSON.stringify({ error: 'not authorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const pending = await rpc<PendingDelivery[]>('get_pending_push_deliveries', {});
    if (pending.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const messages = batch.map((d) => {
        const eventType = typeof d.data?.eventType === 'string' ? (d.data.eventType as string) : undefined;
        const isRiderDeliveryAlert = !!eventType && RIDER_DELIVERY_EVENT_TYPES.has(eventType);
        const isHighPriority = d.priority === 'urgent' || d.priority === 'high';
        return {
          to: d.device_token,
          title: d.title,
          body: d.body,
          data: d.data,
          priority: isHighPriority ? 'high' : 'default',
          // Android's notification sound is entirely channel-controlled
          // (see pushRegistration.ts) — this field only does anything on
          // iOS. Left unset for every other notification type exactly as
          // before (no regression); the rider alert is the one case that
          // gets its own bundled sound on both platforms.
          sound: isRiderDeliveryAlert ? RIDER_DELIVERY_SOUND : undefined,
          // Routes a rider "New Delivery"-class alert to its own
          // high-importance channel (distinct sound + vibration pattern,
          // heads-up, lock-screen visible) instead of the shared 'urgent'
          // channel every other high-priority notification (new customer
          // order to store staff, admin alerts, etc.) still uses.
          channelId:
            d.platform === 'android'
              ? isRiderDeliveryAlert
                ? 'rider-delivery-alerts'
                : isHighPriority
                  ? 'urgent'
                  : 'default'
              : undefined,
        };
      });

      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      const result = await res.json().catch(() => null);
      const tickets: Array<{ status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }> =
        result?.data ?? [];

      for (let j = 0; j < batch.length; j++) {
        const delivery = batch[j];
        const ticket = tickets[j];

        if (!res.ok || !ticket) {
          // Whole request failed (network/Expo outage) — retry every
          // delivery in this batch with backoff, never mark them
          // permanently failed for a transient provider-side issue.
          await rpc('mark_push_delivery_retry', {
            p_delivery_id: delivery.id,
            p_attempt_count: delivery.attempt_count + 1,
            p_backoff_seconds: backoffSeconds(delivery.attempt_count),
            p_error: `request failed: ${res.status}`,
          });
          failed++;
          continue;
        }

        if (ticket.status === 'ok') {
          await rpc('mark_push_delivery_sent', { p_delivery_id: delivery.id, p_provider_message_id: ticket.id ?? '' });
          sent++;
        } else {
          const deviceError = ticket.details?.error;
          if (deviceError === 'DeviceNotRegistered') {
            // section 6/54: a token Expo says is dead gets deactivated —
            // never retried, never silently left active.
            await rpc('mark_push_delivery_dead_token', { p_delivery_id: delivery.id, p_device_id: delivery.device_id });
          } else if (delivery.attempt_count + 1 >= MAX_ATTEMPTS) {
            await rpc('mark_push_delivery_failed', { p_delivery_id: delivery.id, p_error: ticket.message ?? deviceError ?? 'unknown error' });
          } else {
            await rpc('mark_push_delivery_retry', {
              p_delivery_id: delivery.id,
              p_attempt_count: delivery.attempt_count + 1,
              p_backoff_seconds: backoffSeconds(delivery.attempt_count),
              p_error: ticket.message ?? deviceError ?? 'unknown error',
            });
          }
          failed++;
        }
      }
    }

    return new Response(JSON.stringify({ processed: pending.length, sent, failed }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
