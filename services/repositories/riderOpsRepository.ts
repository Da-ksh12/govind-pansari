import { supabase } from '../supabase/client';
import { liveFeed } from '../realtime/liveFeed';
import { toCatalogueError } from '../supabase/errors';
import { getDeliveryProofPhotoUrl } from '../storage/deliveryProof';

export type RiderStatus = 'offline' | 'available' | 'assigned' | 'at_store' | 'picking_up' | 'delivering' | 'suspended';
export type DeliveryStatus = 'assigned' | 'accepted' | 'at_store' | 'picked_up' | 'in_transit' | 'completed' | 'failed' | 'declined' | 'expired' | 'cancelled';
export type DeliveryFailureReason = 'customer_unavailable' | 'wrong_address' | 'customer_refused' | 'other';

export interface CurrentAssignment {
  assignmentId: string;
  orderId: string;
  orderNumber: string;
  status: DeliveryStatus;
  /** orders.status — distinct from `status` (delivery_assignments.status) above. mark_order_approaching() only ever touches this field, never the assignment's own status, so "has this rider already tapped I've Reached Destination" can only be read from here, not from `status`. */
  orderStatus: string;
  itemCount: number;
  total: number;
  storeName: string;
  storeAddress: string;
  storeLatitude: number;
  storeLongitude: number;
  deliveryCity: string;
  deliveryAddressLine1: string;
  /** Area / locality, landmark and the customer's delivery instructions (only present on the full delivery detail, not the dashboard summary). */
  deliveryAddressLine2?: string;
  deliveryLandmark?: string;
  deliveryInstructions?: string;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  recipientName: string;
  recipientPhone: string;
  assignedAt: string;
  expiresAt: string | null;
}

export interface RiderDashboard {
  riderId: string;
  status: RiderStatus;
  isAvailable: boolean;
  isActive: boolean;
  todayDeliveredCount: number;
  currentAssignment: CurrentAssignment | null;
}

export interface DeliveryHistoryItem {
  id: string;
  orderId: string;
  orderNumber: string;
  status: DeliveryStatus;
  total: number;
  assignedAt: string;
  completedAt: string | null;
  failedAt: string | null;
}

function mapAssignment(row: any): CurrentAssignment | null {
  if (!row) return null;
  return {
    assignmentId: row.id,
    orderId: row.order_id,
    orderNumber: row.orders.order_number,
    status: row.status,
    orderStatus: row.orders.status,
    itemCount: row.orders.order_items?.length ?? 0,
    total: Number(row.orders.total),
    storeName: row.stores.name,
    storeAddress: row.stores.address_line,
    storeLatitude: row.stores.latitude,
    storeLongitude: row.stores.longitude,
    deliveryCity: row.orders.delivery_address?.city ?? '',
    deliveryAddressLine1: row.orders.delivery_address?.address_line_1 ?? '',
    deliveryAddressLine2: row.orders.delivery_address?.address_line_2 ?? undefined,
    deliveryLandmark: row.orders.delivery_address?.landmark ?? undefined,
    deliveryInstructions: row.orders.delivery_address?.delivery_instructions ?? undefined,
    deliveryLatitude: row.orders.delivery_address?.latitude ?? null,
    deliveryLongitude: row.orders.delivery_address?.longitude ?? null,
    recipientName: row.orders.delivery_address?.recipient_name ?? '',
    recipientPhone: row.orders.delivery_address?.phone ?? '',
    assignedAt: row.assigned_at,
    expiresAt: row.expires_at,
  };
}

export type DeliveryOfferStatus = 'open' | 'accepted' | 'declined' | 'expired' | 'lost' | 'cancelled';

/** One fanned-out dispatch offer (Final Dispatch pass) — distinct from CurrentAssignment: this rider hasn't won anything yet, they're one of possibly several riders being asked. */
export interface DeliveryOfferDetail {
  offerId: string;
  dispatchRoundId: string;
  orderId: string;
  orderNumber: string;
  status: DeliveryOfferStatus;
  itemCount: number;
  total: number;
  storeName: string;
  /** Real, from the rider's last known location — null when they have none on file yet (only populated once a rider has completed at least one delivery). Never invented. */
  distanceMeters: number | null;
  expiresAt: string;
}

function mapOffer(row: any): DeliveryOfferDetail | null {
  if (!row) return null;
  return {
    offerId: row.id,
    dispatchRoundId: row.dispatch_round_id,
    orderId: row.order_id,
    orderNumber: row.orders.order_number,
    status: row.status,
    itemCount: row.orders.order_items?.length ?? 0,
    total: Number(row.orders.total),
    storeName: row.stores.name,
    distanceMeters: row.distance_meters != null ? Number(row.distance_meters) : null,
    expiresAt: row.expires_at,
  };
}

export interface RiderProfile {
  vehicleType: string;
  vehicleNumber: string | null;
  primaryStoreName: string | null;
}

/** Same shape as storeOpsRepository's CompletedDeliveryProof — the rider's own view of the mandatory photo+location proof they captured, for a delivery in their own history. */
export interface DeliveryProof {
  completedAt: string;
  cashCollected: number | null;
  photoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
}

export const riderOpsRepository = {
  /**
   * Realtime for the rider dashboard/delivery screens (pre-production
   * hardening, part 13) — before this, app/rider/** had NO realtime
   * subscription at all, only useFocusEffect. A store manager/admin
   * assigning a rider already triggers a push/in-app notification
   * (Phase 10), but the dashboard screen itself sat stale until the
   * rider manually navigated away and back. Same "something changed,
   * go refetch" signal as storeOpsRepository.subscribeToStoreActivity,
   * scoped to this rider's own assignments only.
   */
  subscribeToRiderActivity(riderId: string, onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'delivery_assignments', filter: `rider_id=eq.${riderId}` }], onChange);
  },

  /** Rejected server-side unless the rider currently has a delivery in an eligible stage (section 6/7) — see submit_rider_location(). */
  async submitLocation(loc: { latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number; altitude?: number }) {
    const { data, error } = await supabase.rpc('submit_rider_location', {
      p_latitude: loc.latitude,
      p_longitude: loc.longitude,
      p_accuracy: loc.accuracy ?? null,
      p_heading: loc.heading ?? null,
      p_speed: loc.speed ?? null,
      p_altitude: loc.altitude ?? null,
    });
    if (error) throw toCatalogueError(error);
    return data as { success: boolean; locationId: number; flagged: boolean; deliveryId: string };
  },

  async getRiderProfile(): Promise<RiderProfile | null> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return null;
    const { data, error } = await supabase
      .from('riders')
      .select('vehicle_type, vehicle_number, stores(name)')
      .eq('profile_id', user.user.id)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return null;
    return {
      vehicleType: data.vehicle_type,
      vehicleNumber: data.vehicle_number,
      primaryStoreName: (data as any).stores?.name ?? null,
    };
  },


  async getDashboard(): Promise<RiderDashboard> {
    const { data, error } = await supabase.rpc('get_rider_dashboard');
    if (error) throw toCatalogueError(error);
    const d = data as any;
    return {
      riderId: d.riderId,
      status: d.status,
      isAvailable: d.isAvailable,
      isActive: d.isActive,
      todayDeliveredCount: d.todayDeliveredCount,
      currentAssignment: d.currentAssignment
        ? {
            assignmentId: d.currentAssignment.assignmentId,
            orderId: d.currentAssignment.orderId,
            orderNumber: d.currentAssignment.orderNumber,
            status: d.currentAssignment.status,
            orderStatus: d.currentAssignment.orderStatus,
            itemCount: d.currentAssignment.itemCount,
            total: Number(d.currentAssignment.total),
            storeName: d.currentAssignment.storeName,
            storeAddress: d.currentAssignment.storeAddress,
            storeLatitude: d.currentAssignment.storeLatitude,
            storeLongitude: d.currentAssignment.storeLongitude,
            deliveryCity: d.currentAssignment.deliveryCity,
            deliveryAddressLine1: d.currentAssignment.deliveryAddressLine1,
            deliveryLatitude: d.currentAssignment.deliveryLatitude,
            deliveryLongitude: d.currentAssignment.deliveryLongitude,
            recipientName: d.currentAssignment.recipientName,
            recipientPhone: d.currentAssignment.recipientPhone,
            assignedAt: d.currentAssignment.assignedAt,
            expiresAt: d.currentAssignment.expiresAt,
          }
        : null,
    };
  },

  async setAvailability(available: boolean) {
    const { error } = await supabase.rpc('set_rider_availability', { p_available: available });
    if (error) throw toCatalogueError(error);
  },

  async acceptDelivery(assignmentId: string) {
    const { error } = await supabase.rpc('accept_delivery', { p_assignment_id: assignmentId });
    if (error) throw toCatalogueError(error);
  },
  async declineDelivery(assignmentId: string, reason?: string) {
    const { error } = await supabase.rpc('decline_delivery', { p_assignment_id: assignmentId, p_reason: reason ?? null });
    if (error) throw toCatalogueError(error);
  },

  /**
   * Cold-start / background-reconnect fallback (section 13): Realtime
   * only delivers events that occur WHILE the socket is connected — an
   * offer that arrived while this rider's app was backgrounded/killed
   * never replays into notificationsStore's `incoming`. Called once on
   * NewDeliveryPrompt mount and again on every foreground, so a rider
   * who opens the app cold (via the push notification or otherwise)
   * still sees any offer that's genuinely still open for them, not
   * just ones that happened to arrive while they were already looking
   * at the screen.
   */
  async getMyOpenOffer(): Promise<DeliveryOfferDetail | null> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return null;
    const riderRes = await supabase.from('riders').select('id').eq('profile_id', user.user.id).maybeSingle();
    if (!riderRes.data) return null;

    const { data, error } = await supabase
      .from('delivery_offers')
      .select('id, dispatch_round_id, order_id, status, distance_meters, expires_at, orders(order_number, total, order_items(id)), stores(name)')
      .eq('rider_id', riderRes.data.id)
      .eq('status', 'open')
      .gt('expires_at', new Date().toISOString())
      .order('offered_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null; // best-effort background check — never surface an error for this
    return mapOffer(data);
  },

  /** Final Dispatch pass — one rider's view of one fanned-out offer, before anyone has won it. */
  async getOfferDetail(offerId: string): Promise<DeliveryOfferDetail | null> {
    const { data, error } = await supabase
      .from('delivery_offers')
      .select('id, dispatch_round_id, order_id, status, distance_meters, expires_at, orders(order_number, total, order_items(id)), stores(name)')
      .eq('id', offerId)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    return mapOffer(data);
  },

  /**
   * The ONLY place a rider's acceptance becomes real — a typed
   * {success, code, message} result, never a thrown exception for the
   * expected "someone else already won" case, so the UI can show a
   * calm "accepted by another rider" state rather than a raw error
   * (section 6/15/39/40 — the backend, not this call site, decides the
   * winner).
   */
  async acceptDeliveryOffer(offerId: string): Promise<{ success: boolean; code?: string; message?: string; assignmentId?: string; orderId?: string }> {
    const { data, error } = await supabase.rpc('accept_delivery_offer', { p_offer_id: offerId });
    if (error) throw toCatalogueError(error);
    return data;
  },

  async declineDeliveryOffer(offerId: string, reason?: string) {
    const { error } = await supabase.rpc('decline_delivery_offer', { p_offer_id: offerId, p_reason: reason ?? null });
    if (error) throw toCatalogueError(error);
  },

  /** Live "did I just lose this offer to someone else" signal (section 15) — the rider's own row flips OPEN -> LOST/EXPIRED the instant another rider wins or the round times out; RLS already scopes delivery_offers to the rider's own rows. */
  subscribeToOffer(offerId: string, onChange: () => void): () => void {
    return liveFeed.watch([{ table: 'delivery_offers', event: 'UPDATE', filter: `id=eq.${offerId}` }], onChange, { catchUpOnConnect: true });
  },
  async markArrivedAtStore(assignmentId: string) {
    const { error } = await supabase.rpc('mark_arrived_at_store', { p_assignment_id: assignmentId });
    if (error) throw toCatalogueError(error);
  },
  async markPickedUp(assignmentId: string, orderNumber: string) {
    const { error } = await supabase.rpc('mark_picked_up', { p_assignment_id: assignmentId, p_order_number: orderNumber });
    if (error) throw toCatalogueError(error);
  },
  async startDelivery(assignmentId: string) {
    const { error } = await supabase.rpc('start_delivery', { p_assignment_id: assignmentId });
    if (error) throw toCatalogueError(error);
  },
  /** Explicit "I've Reached Destination" (section 14) — a reliable manual signal in place of unfinished GPS-proximity auto-arrival. Moves the order to 'approaching'; complete_delivery() still accepts it as a valid pre-completion state either way. */
  async markApproaching(orderId: string) {
    const { error } = await supabase.rpc('mark_order_approaching', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
  },
  async completeDelivery(assignmentId: string, proofPhotoPath: string, proofLocation: { latitude: number; longitude: number }, cashCollected?: number) {
    const { error } = await supabase.rpc('complete_delivery', {
      p_assignment_id: assignmentId,
      p_proof_photo_url: proofPhotoPath,
      p_proof_latitude: proofLocation.latitude,
      p_proof_longitude: proofLocation.longitude,
      p_cash_collected: cashCollected ?? null,
    });
    if (error) throw toCatalogueError(error);
  },
  async failDelivery(assignmentId: string, reason: DeliveryFailureReason, notes?: string) {
    const { error } = await supabase.rpc('fail_delivery', { p_assignment_id: assignmentId, p_reason: reason, p_notes: notes ?? null });
    if (error) throw toCatalogueError(error);
  },

  async getDeliveryDetail(assignmentId: string): Promise<CurrentAssignment | null> {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select(
        'id, order_id, status, assigned_at, expires_at, ' +
        'orders(order_number, status, total, delivery_address, order_items(id)), ' +
        'stores(name, address_line, latitude, longitude)',
      )
      .eq('id', assignmentId)
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    return mapAssignment(data);
  },

  /** The rider's own proof-of-delivery for a completed delivery in their history — the rider-side equivalent of storeOpsRepository.getDeliveryProof. RLS (delivery_assignments) already scopes this to the rider's own rows. Null until the delivery actually completes. */
  async getDeliveryProof(assignmentId: string): Promise<DeliveryProof | null> {
    const { data, error } = await supabase
      .from('delivery_assignments')
      .select('completed_at, cash_collected, delivery_proof_photo_url, delivery_proof_latitude, delivery_proof_longitude')
      .eq('id', assignmentId)
      .eq('status', 'completed')
      .maybeSingle();
    if (error) throw toCatalogueError(error);
    if (!data) return null;
    const photoUrl = data.delivery_proof_photo_url ? await getDeliveryProofPhotoUrl(data.delivery_proof_photo_url) : null;
    return {
      completedAt: data.completed_at,
      cashCollected: data.cash_collected,
      photoUrl,
      latitude: data.delivery_proof_latitude,
      longitude: data.delivery_proof_longitude,
    };
  },

  /** Today's + recent past deliveries — never the whole table (section 60). */
  async listHistory(): Promise<DeliveryHistoryItem[]> {
    const { data: rider } = await supabase.auth.getUser();
    if (!rider.user) return [];
    const riderRes = await supabase.from('riders').select('id').eq('profile_id', rider.user.id).maybeSingle();
    if (!riderRes.data) return [];

    const { data, error } = await supabase
      .from('delivery_assignments')
      .select('id, order_id, status, assigned_at, completed_at, failed_at, orders(order_number, total)')
      .eq('rider_id', riderRes.data.id)
      .in('status', ['completed', 'failed', 'cancelled'])
      .order('assigned_at', { ascending: false })
      .limit(50);
    if (error) throw toCatalogueError(error);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.orders?.order_number ?? '',
      status: r.status,
      total: Number(r.orders?.total ?? 0),
      assignedAt: r.assigned_at,
      completedAt: r.completed_at,
      failedAt: r.failed_at,
    }));
  },
};
