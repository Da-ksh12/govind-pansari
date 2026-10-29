import { supabase } from '../supabase/client';
import { liveFeed } from '../realtime/liveFeed';
import { toCatalogueError } from '../supabase/errors';
import type { NotificationType } from '../../types/models';

export type NotificationEventType =
  | 'order_placed'
  | 'order_confirmed'
  | 'order_preparing'
  | 'order_packed'
  | 'rider_assigned'
  | 'rider_at_store'
  | 'order_picked_up'
  | 'order_out_for_delivery'
  | 'delivery_arriving'
  | 'order_delivered'
  | 'delivery_failed'
  | 'order_cancelled'
  | 'delivery_assigned'
  | 'delivery_reminder'
  | 'delivery_reassigned'
  | 'delivery_exception'
  | 'delivery_offer'
  | 'dispatch_round_expired'
  | 'store_new_order'
  | 'admin_unassigned_delivery'
  | 'admin_failed_delivery'
  | 'admin_system_alert';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface AppNotificationRow {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  eventType: NotificationEventType;
  data: Record<string, string>;
  priority: NotificationPriority;
  readAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

function mapRow(r: any): AppNotificationRow {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    type: r.type,
    eventType: r.event_type,
    data: r.data ?? {},
    priority: r.priority,
    readAt: r.read_at,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}

export const notificationRepository = {
  /** Cursor-paginated (section 50) — pass the last row's createdAt back as cursor for the next page. */
  async list(cursor?: string, limit = 20): Promise<AppNotificationRow[]> {
    const { data, error } = await supabase.rpc('get_notifications', { p_cursor: cursor ?? null, p_limit: limit });
    if (error) throw toCatalogueError(error);
    return ((data ?? []) as any[]).map(mapRow);
  },

  async getUnreadCount(): Promise<number> {
    const { data, error } = await supabase.rpc('get_unread_notification_count');
    if (error) throw toCatalogueError(error);
    return (data as number) ?? 0;
  },

  /** Single mark-read goes through the direct, RLS-scoped read_at column grant — no RPC needed (section 11). */
  async markRead(notificationId: string): Promise<void> {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notificationId).is('read_at', null);
    if (error) throw toCatalogueError(error);
  },

  async markAllRead(): Promise<number> {
    const { data, error } = await supabase.rpc('mark_all_notifications_read');
    if (error) throw toCatalogueError(error);
    return (data as number) ?? 0;
  },

  /** Called once by the tracking screen when its own ETA first crosses the arriving-soon threshold (section 47) — deduped server-side. */
  async notifyArrivingSoon(orderId: string): Promise<void> {
    const { error } = await supabase.rpc('notify_arriving_soon', { p_order_id: orderId });
    if (error) throw toCatalogueError(error);
  },

  /** Identity always comes from the session server-side (section 6) — never a client-supplied user id. */
  async registerDevice(token: string, platform: 'ios' | 'android', appVersion?: string, deviceId?: string): Promise<void> {
    const { error } = await supabase.rpc('register_device_token', {
      p_device_token: token,
      p_platform: platform,
      p_app_version: appVersion ?? null,
      p_device_id: deviceId ?? null,
    });
    if (error) throw toCatalogueError(error);
  },

  async deactivateDevice(token: string): Promise<void> {
    const { error } = await supabase.rpc('deactivate_device_token', { p_device_token: token });
    if (error) throw toCatalogueError(error);
  },

  /** Transactional order/delivery/system notifications are never gated by preference (section 29) — only this. */
  async getPromotionsEnabled(): Promise<boolean> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return true;
    const { data, error } = await supabase.from('notification_preferences').select('promotions_enabled').eq('user_id', user.user.id).maybeSingle();
    if (error) throw toCatalogueError(error);
    return data?.promotions_enabled ?? true; // no row yet = default enabled
  },

  async setPromotionsEnabled(enabled: boolean): Promise<void> {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    const { error } = await supabase.from('notification_preferences').upsert({ user_id: user.user.id, promotions_enabled: enabled });
    if (error) throw toCatalogueError(error);
  },

  /**
   * Live updates for an open notification center/bell (section 9/51).
   * Same "channel name isn't the security boundary, RLS is" pattern as
   * Phase 09's tracking subscriptions — filtered by user_id here only
   * for the client's own routing convenience.
   */
  subscribe(userId: string, onInsert: (row: AppNotificationRow) => void, onResync?: () => void): () => void {
    return liveFeed.watchRows(
      { table: 'notifications', event: 'INSERT', filter: `user_id=eq.${userId}` },
      (change) => onInsert(mapRow(change.new)),
      // A notification inserted while the socket was down is never replayed: reload the list and the badge instead.
      { onResync, resyncOnForeground: true },
    );
  },
};
