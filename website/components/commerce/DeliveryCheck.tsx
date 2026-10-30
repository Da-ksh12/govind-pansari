'use client';

import { CheckCircle2, Clock, Info, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkServiceability, readSavedPlace, savePlace, type Place } from '@/lib/location';
import { describeServiceability, describeServiceabilityFailure, type ServiceabilityMessage, type ServiceabilityResult } from '@/lib/serviceability';
import { formatINR } from '@/lib/format';
import { PlaceSearch } from './PlaceSearch';

interface Outcome {
  place: Place;
  message: ServiceabilityMessage;
  result: ServiceabilityResult | null;
}

/** Asks the server about a place and words the answer; a failed check is reported as a failed check, never as "outside the area". */
async function evaluate(place: Place): Promise<Outcome> {
  try {
    const result = await checkServiceability(place.lat, place.lng);
    return { place, result, message: describeServiceability(result) };
  } catch {
    return { place, result: null, message: describeServiceabilityFailure() };
  }
}

/**
 * "Can you deliver to me?" Asks the server's own check (check_serviceability) for the chosen position — the same rule checkout uses — and words the
 * answer with the same sentences as the mobile app. Nothing here decides serviceability on its own.
 */
export function DeliveryCheck({ freeDeliveryAbove }: { freeDeliveryAbove: number | null }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(false);

  async function run(place: Place) {
    savePlace(place);
    setChecking(true);
    setOutcome(await evaluate(place));
    setChecking(false);
  }

  // pick up where the visitor left off
  useEffect(() => {
    const saved = readSavedPlace();
    if (!saved) return;
    let alive = true;
    void evaluate(saved).then((o) => {
      if (alive) setOutcome(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  const tone = outcome?.message.tone;
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'closed' ? Clock : tone === 'error' ? Info : XCircle;
  const toneClass = tone === 'ok' ? 'bg-forest-tint text-forest' : tone === 'closed' ? 'bg-gold-tint text-gold-dark' : tone === 'error' ? 'bg-sand text-taupe' : 'bg-terracotta-tint text-terracotta';
  const served = outcome?.result && outcome.result.serviceable ? outcome.result : null;

  return (
    <section aria-labelledby="delivery-check" className="rounded-2xl border border-line-strong bg-paper p-5">
      <h2 id="delivery-check" className="font-display text-lg font-semibold text-maroon">Check delivery to you</h2>
      <p className="mt-1 text-sm text-taupe">Search your area or pincode, or use your location.</p>
      <div className="mt-4">
        <PlaceSearch onPick={run} value={outcome?.place.label ?? ''} />
      </div>
      <div aria-live="polite" className="mt-4">
        {checking && <p className="text-sm text-taupe">Checking…</p>}
        {!checking && outcome && (
          <div className={`flex gap-3 rounded-xl p-4 text-sm ${toneClass}`}>
            <Icon size={20} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-bold">{outcome.message.title}</p>
              <p className="mt-0.5 leading-relaxed">{outcome.message.message}</p>
              {served && (
                <p className="mt-2 font-semibold">
                  About {served.estimatedDeliveryMinutes} min · delivery {served.deliveryFee === 0 ? 'free' : formatINR(served.deliveryFee)}
                  {freeDeliveryAbove ? ` (free above ${formatINR(freeDeliveryAbove)})` : ''} · minimum order {formatINR(served.minimumOrderValue)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
