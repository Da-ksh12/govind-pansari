import { Check, Circle } from 'lucide-react';
import { buildTimeline, describeStatus, statusBadge, type OrderStatus, type StatusHistoryRow } from '@/lib/orders/timeline';
import { formatDateTimeIST } from '@/lib/format';

const TONE = {
  waiting: 'bg-gold-tint text-gold-dark',
  progress: 'bg-maroon-tint text-maroon',
  done: 'bg-forest-tint text-forest',
  cancelled: 'bg-sand text-taupe',
} as const;

export function StatusChip({ status }: { status: OrderStatus }) {
  const badge = statusBadge(status);
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wider ${TONE[badge.tone]}`}>{badge.label}</span>;
}

/** The order's real progress. Times come from the order's status history; a stage the order has not reached has no time. */
export function OrderTimeline({ status, history, placedAt }: { status: OrderStatus; history: StatusHistoryRow[]; placedAt: string }) {
  const steps = buildTimeline(status, history, placedAt);
  if (!steps) {
    return <p className="rounded-2xl bg-sand p-4 text-sm font-semibold text-taupe">{describeStatus('cancelled')}</p>;
  }
  return (
    <div>
      <p className="mb-6 text-sm font-semibold text-espresso">{describeStatus(status)}</p>
      <ol aria-label="Order progress" className="relative space-y-0">
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={step.key} className="relative flex gap-4 pb-7 last:pb-0" aria-current={step.state === 'current' ? 'step' : undefined}>
              {!last && <span className={`absolute left-[0.95rem] top-8 h-[calc(100%-1.5rem)] w-0.5 ${step.state === 'done' ? 'bg-forest' : 'bg-line-strong'}`} aria-hidden />}
              <span
                className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 ${
                  step.state === 'done' ? 'border-forest bg-forest text-white' : step.state === 'current' ? 'border-maroon bg-ivory text-maroon' : 'border-line-strong bg-ivory text-stone'
                }`}
              >
                {step.state === 'done' ? <Check size={16} strokeWidth={3} aria-hidden /> : <Circle size={10} fill="currentColor" aria-hidden className={step.state === 'current' ? 'animate-pulse' : ''} />}
              </span>
              <div className="pt-0.5">
                <p className={`text-sm font-extrabold ${step.state === 'upcoming' ? 'text-stone' : 'text-espresso'}`}>
                  {step.label}
                  <span className="sr-only">{step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (current step)' : ' (not yet)'}</span>
                </p>
                <p className="text-xs text-taupe">{step.state === 'upcoming' ? step.hint : step.at ? formatDateTimeIST(step.at) : step.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
