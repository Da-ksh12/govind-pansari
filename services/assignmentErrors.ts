/**
 * Turns the hand-written messages raised by assign_rider() and friends into
 * advice an admin can act on. `refresh` means the list the admin is looking
 * at is probably stale (another admin assigned the order first), so the UI
 * should reload it rather than leave a dead row on screen.
 */
export interface AssignFailure {
  message: string;
  refresh: boolean;
}

export function describeAssignmentError(raw: unknown): AssignFailure {
  const text = (raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '').toLowerCase();

  if (text.includes('not ready for rider assignment')) {
    return {
      message: 'This order is no longer waiting for a rider — someone else may have just assigned one. The list has been refreshed.',
      refresh: true,
    };
  }
  if (text.includes('terminal state')) {
    return { message: 'This assignment has already ended — the rider may have just declined or someone else cancelled it. The screen has been refreshed.', refresh: true };
  }
  if (text.includes('not authorized to cancel')) {
    return { message: "You don't have permission to cancel this assignment.", refresh: false };
  }
  if (text.includes('at capacity')) {
    return { message: 'That rider already has the maximum number of active deliveries. Choose another rider.', refresh: false };
  }
  if (text.includes('not available') || text.includes('inactive') || text.includes('rider not found')) {
    return { message: 'That rider is no longer available. Choose another rider.', refresh: false };
  }
  if (text.includes('not authorized')) {
    return { message: "You don't have permission to assign riders for this order.", refresh: false };
  }
  if (text.includes('waiting for its online payment')) {
    return { message: "This order's online payment hasn't been confirmed yet, so it can't be dispatched.", refresh: true };
  }
  return { message: "Couldn't assign a rider. Please try again.", refresh: false };
}
