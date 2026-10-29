// Manual rider assignment: the pure rules behind the "choose a rider" list, the "this rider did not accept"
// prompt and the two-step cancel. No React Native / Supabase imports, so tests/unit covers every rule.

/** The statuses get_riders_for_assignment() reports for each rider. */
export type RiderStatus = 'free' | 'request_pending' | 'heading_to_store' | 'at_store' | 'delivering' | 'offline';
export type RiderStatusTone = 'good' | 'busy' | 'muted';

const STATUS: Record<RiderStatus, { label: string; tone: RiderStatusTone }> = {
  free: { label: 'Free', tone: 'good' },
  request_pending: { label: 'Request pending', tone: 'busy' },
  heading_to_store: { label: 'Heading to store', tone: 'busy' },
  at_store: { label: 'At a store', tone: 'busy' },
  delivering: { label: 'Delivering', tone: 'busy' },
  offline: { label: 'Offline', tone: 'muted' },
};

export function describeRiderStatus(status: string): { label: string; tone: RiderStatusTone } {
  return STATUS[status as RiderStatus] ?? { label: 'Unknown', tone: 'muted' };
}

const STALE_LOCATION_SECONDS = 15 * 60;

function formatAge(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

/** "850 m away", "1.4 km away" — with how old the position is once it is no longer fresh. */
export function formatRiderDistance(distanceMeters: number | null, locationAgeSeconds: number | null): string {
  if (distanceMeters == null) return 'Location unknown';
  const away = distanceMeters < 1000 ? `${Math.round(distanceMeters)} m away` : `${(distanceMeters / 1000).toFixed(1)} km away`;
  return locationAgeSeconds != null && locationAgeSeconds > STALE_LOCATION_SECONDS ? `${away} · seen ${formatAge(locationAgeSeconds)} ago` : away;
}

/** Why a rider in the list cannot be picked right now, or null when they can. */
export function riderBlockedReason(rider: { canAssign: boolean; status: string; activeDeliveries: number; capacity: number }): string | null {
  if (rider.canAssign) return null;
  if (rider.status === 'offline') return 'Offline — not taking orders';
  return `At delivery limit (${rider.activeDeliveries}/${rider.capacity})`;
}

// ---------------------------------------------------------------------------
// "This rider did not accept" — asked again until someone is chosen
// ---------------------------------------------------------------------------

export interface RiderAttempt {
  assignmentId: string;
  riderId: string;
  riderName: string;
  status: string;
  reason: string | null;
  assignedAt: string;
  endedAt: string | null;
}

/**
 * The newest attempt, when it ended because the rider declined or never answered and nobody has been chosen since.
 * (A cancel is the manager's own decision and needs no prompt; a completed delivery needs none either.)
 */
export function unansweredAttempt(attempts: RiderAttempt[], hasActiveDelivery: boolean): RiderAttempt | null {
  if (hasActiveDelivery) return null;
  const latest = attempts[0];
  return latest && (latest.status === 'declined' || latest.status === 'expired') ? latest : null;
}

export function describeUnanswered(attempt: RiderAttempt): { title: string; detail: string } {
  if (attempt.status === 'declined') {
    return { title: `${attempt.riderName} declined this order`, detail: attempt.reason ? `Reason: ${attempt.reason}` : 'No reason was given.' };
  }
  return { title: `${attempt.riderName} didn't respond`, detail: 'The request ran out of time (5 minutes).' };
}

// ---------------------------------------------------------------------------
// Cancelling an assignment: two separate confirmations, then straight on to choosing again
// ---------------------------------------------------------------------------

/** Until the rider has the parcel an assignment can still be taken back. */
export function canCancelAssignment(status: string): boolean {
  return status === 'assigned' || status === 'accepted' || status === 'at_store';
}

export type CancelStep = 'closed' | 'first' | 'second';
export type CancelAction = 'open' | 'continue' | 'back' | 'finished';

/** The second prompt can only be reached through the first, so a single stray tap can never cancel. */
export function nextCancelStep(step: CancelStep, action: CancelAction): CancelStep {
  switch (action) {
    case 'open':
      return 'first';
    case 'continue':
      return step === 'first' ? 'second' : step;
    case 'back':
    case 'finished':
      return 'closed';
  }
}

export function cancelPrompt(
  step: Exclude<CancelStep, 'closed'>,
  riderName: string,
  orderNumber: string,
  deliveryStatus: string,
): { title: string; message: string; primaryLabel: string; secondaryLabel: string } {
  if (step === 'first') {
    return {
      title: 'Cancel this assignment?',
      message:
        deliveryStatus === 'assigned'
          ? `${riderName} hasn't accepted Order #${orderNumber} yet.`
          : `${riderName} has accepted Order #${orderNumber} and is already on the way.`,
      primaryLabel: 'Yes, cancel',
      secondaryLabel: 'Keep rider',
    };
  }
  return {
    title: 'Are you sure?',
    message: `${riderName} will be told Order #${orderNumber} was taken away, and you will need to choose another rider straight away.`,
    primaryLabel: 'Yes, cancel assignment',
    secondaryLabel: 'No, keep',
  };
}
