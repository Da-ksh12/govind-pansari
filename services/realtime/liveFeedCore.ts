// One place that owns every Supabase Realtime (Postgres Changes) subscription the app opens.
//
// What it guarantees, and why each point exists:
//  * ONE channel per (table, event, filter), however many screens ask for it. expo-router keeps earlier
//    screens mounted, so the dashboard, the orders list and a detail screen all want `orders` at once;
//    before this each opened its own channel and its own copy of the same stream.
//  * Listener cleanup is exact: the last listener to leave removes the channel; calling an unsubscribe
//    twice is harmless; nothing is delivered after unsubscribe.
//  * A missed-event gap is never silently ignored. If a channel drops (CHANNEL_ERROR / TIMED_OUT /
//    CLOSED) and later comes back (SUBSCRIBED), every listener is told to refetch, because Postgres
//    Changes is a live stream and does not replay what happened while it was down.
//  * Bursts collapse: `watch` hands a screen at most one "something changed, refetch" call per window
//    (leading + trailing), so updating 50 inventory rows is one reload, not fifty.
//
// This file is pure (no React Native, no Supabase import) so it is unit-tested in Node with a fake client.

export type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface Binding {
  table: string;
  event?: ChangeEvent;
  /** PostgREST-style filter, e.g. `user_id=eq.<uuid>`. Realtime checks RLS for every row regardless of it. */
  filter?: string;
  schema?: string;
}

export interface RowChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, any>;
  old: Record<string, any>;
}

export interface ChannelLike {
  on(type: 'postgres_changes', filter: Record<string, unknown>, callback: (payload: any) => void): ChannelLike;
  subscribe(callback?: (status: string, err?: unknown) => void): unknown;
}

export interface RealtimeClientLike {
  channel(name: string): ChannelLike;
  removeChannel(channel: ChannelLike): unknown;
}

export interface WatchOptions {
  /** Minimum gap between two onChange calls. Default 300 ms. */
  coalesceMs?: number;
  /**
   * Also refetch the first time the channel becomes ready. A channel takes a moment to join (on a slow network, several
   * seconds), and anything that changes between the screen's own fetch and that moment is otherwise never seen.
   * Default TRUE; pass false only for a screen that is happy to miss that window.
   */
  catchUpOnConnect?: boolean;
  /** Also refetch when the app returns to the foreground. For stores that have no screen-level hook. Default false. */
  resyncOnForeground?: boolean;
}

export interface RowWatchOptions {
  /** Called after a dropped channel is re-established (and, with catchUpOnConnect, after the first connect). */
  onResync?: () => void;
  catchUpOnConnect?: boolean;
  resyncOnForeground?: boolean;
}

interface Listener {
  onRow?: (change: RowChange) => void;
  onResync: () => void;
  catchUpOnConnect: boolean;
  resyncOnForeground: boolean;
  /** True until this listener has been told the channel is healthy at least once. */
  awaitingFirstConnect: boolean;
  /** True after the channel dropped; cleared once resynced. */
  stale: boolean;
}

interface Entry {
  key: string;
  channel: ChannelLike;
  listeners: Set<Listener>;
  connected: boolean;
  disposed: boolean;
}

export interface LiveFeedTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const DEFAULT_COALESCE_MS = 300;

export function bindingKey(b: Binding): string {
  return `${b.schema ?? 'public'}.${b.table}|${b.event ?? '*'}|${b.filter ?? ''}`;
}

export function createLiveFeed(client: RealtimeClientLike, timers: LiveFeedTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }) {
  const entries = new Map<string, Entry>();
  let channelCounter = 0;

  function safely(fn: () => void) {
    try {
      fn();
    } catch {
      // One misbehaving screen must not stop the others from hearing the event.
    }
  }

  function handleStatus(entry: Entry, status: string) {
    if (entry.disposed) return;
    if (status === 'SUBSCRIBED') {
      entry.connected = true;
      for (const l of [...entry.listeners]) {
        const needs = l.stale || (l.awaitingFirstConnect && l.catchUpOnConnect);
        l.stale = false;
        l.awaitingFirstConnect = false;
        if (needs) safely(l.onResync);
      }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      entry.connected = false;
      for (const l of entry.listeners) {
        // A listener that never saw the channel healthy has nothing to be stale about: it still has its first-connect catch-up pending.
        if (!l.awaitingFirstConnect) l.stale = true;
      }
    }
  }

  function open(binding: Binding): Entry {
    const key = bindingKey(binding);
    const existing = entries.get(key);
    if (existing) return existing;

    channelCounter += 1;
    const channel = client.channel(`gp-live-${channelCounter}`);
    const entry: Entry = { key, channel, listeners: new Set(), connected: false, disposed: false };
    entries.set(key, entry);
    channel.on(
      'postgres_changes',
      { event: binding.event ?? '*', schema: binding.schema ?? 'public', table: binding.table, ...(binding.filter ? { filter: binding.filter } : {}) },
      (payload: any) => {
        if (entry.disposed) return;
        const change: RowChange = { eventType: payload.eventType, new: payload.new ?? {}, old: payload.old ?? {} };
        for (const l of [...entry.listeners]) if (l.onRow) safely(() => l.onRow!(change));
      },
    );
    channel.subscribe((status) => handleStatus(entry, status));
    return entry;
  }

  function join(binding: Binding, listener: Listener): () => void {
    const entry = open(binding);
    listener.awaitingFirstConnect = !entry.connected;
    entry.listeners.add(listener);
    if (entry.connected && listener.catchUpOnConnect) {
      // Joined an already-healthy channel: nothing was missed since it started listening, but the caller asked to catch up once.
      safely(listener.onResync);
    }
    let left = false;
    return () => {
      if (left) return;
      left = true;
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0 && !entry.disposed) {
        entry.disposed = true;
        if (entries.get(entry.key) === entry) entries.delete(entry.key);
        try {
          client.removeChannel(entry.channel);
        } catch {
          // Already closed: nothing to release.
        }
      }
    };
  }

  /**
   * Raw row changes for one binding (rider location pings, a single order's status). Not coalesced: every row matters.
   * `onResync` fires when the stream had a gap, so the caller can refetch the authoritative state.
   */
  function watchRows(binding: Binding, onRow: (change: RowChange) => void, options: RowWatchOptions = {}): () => void {
    return join(binding, {
      onRow,
      onResync: options.onResync ?? (() => {}),
      catchUpOnConnect: !!options.catchUpOnConnect,
      resyncOnForeground: !!options.resyncOnForeground,
      awaitingFirstConnect: true,
      stale: false,
    });
  }

  /**
   * "Something relevant changed — refetch." Any row on any binding, or a resync after a gap, calls `onChange`;
   * calls are throttled (leading + trailing) to one per `coalesceMs`.
   */
  function watch(bindings: Binding[], onChange: () => void, options: WatchOptions = {}): () => void {
    const windowMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
    let timer: unknown = null;
    let pending = false;
    let closed = false;

    const trigger = () => {
      if (closed) return;
      if (timer !== null) {
        pending = true;
        return;
      }
      safely(onChange);
      timer = timers.setTimeout(() => {
        timer = null;
        if (pending && !closed) {
          pending = false;
          trigger();
        }
      }, windowMs);
    };

    const leaves = bindings.map((binding) =>
      join(binding, {
        onRow: trigger,
        onResync: trigger,
        catchUpOnConnect: options.catchUpOnConnect !== false,
        resyncOnForeground: !!options.resyncOnForeground,
        awaitingFirstConnect: true,
        stale: false,
      }),
    );

    return () => {
      if (closed) return;
      closed = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      for (const leave of leaves) leave();
    };
  }

  /** App returned to the foreground: refetch for the listeners that asked for it. */
  function notifyForeground() {
    for (const entry of entries.values()) {
      for (const l of [...entry.listeners]) if (l.resyncOnForeground) safely(l.onResync);
    }
  }

  return {
    watch,
    watchRows,
    notifyForeground,
    /** Diagnostics and tests: open channels and total listeners. */
    stats: () => ({ channels: entries.size, listeners: [...entries.values()].reduce((n, e) => n + e.listeners.size, 0) }),
  };
}

export type LiveFeed = ReturnType<typeof createLiveFeed>;
