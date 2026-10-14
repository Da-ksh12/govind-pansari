import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ChevronDown, ChevronUp, RotateCcw, Send, Zap } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository } from '../../services/repositories/adminRepository';
import { storeOpsRepository, type DispatchRoundInfo } from '../../services/repositories/storeOpsRepository';
import { riderOpsRepository } from '../../services/repositories/riderOpsRepository';

interface DemoRider {
  id: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  vehicleType: string;
  storeId: string | null;
  storeName: string;
  isActive: boolean;
  isAvailable: boolean;
}

interface DemoOffer {
  offerId: string;
  riderId: string;
  riderName: string;
  status: string;
  distanceMeters: number | null;
}

/**
 * Admin-only QA/demo control panel (Final Dispatch pass, sections
 * 33-40) — lets one person drive the whole "Send Rider -> first to
 * accept wins -> reassign on timeout" lifecycle for a client demo
 * without needing 5+ real phones signed in as different riders. Every
 * action here calls a real backend function (most of them the exact
 * same ones a real customer/store/rider session would call); nothing
 * fakes a result client-side. See qa-scenarios.md in the repo root for
 * the numbered walkthroughs this panel is built to run.
 */
export default function QaPanelScreen() {
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);
  const canManage = hasPermission('settings.manage');

  const [loading, setLoading] = useState(true);
  const [riders, setRiders] = useState<DemoRider[]>([]);
  const [busyRiderIds, setBusyRiderIds] = useState<Set<string>>(new Set());
  const [customers, setCustomers] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof adminRepository.getDemoOrders>>>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [riderActionId, setRiderActionId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<Record<string, DispatchRoundInfo | null>>({});
  const [offers, setOffers] = useState<Record<string, DemoOffer[]>>({});
  const [orderActionId, setOrderActionId] = useState<string | null>(null);
  const [racing, setRacing] = useState(false);

  const load = useCallback(() => {
    if (!canManage) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      adminRepository.getRiders(),
      adminRepository.getBusyRiderIds(),
      adminRepository.getDemoCustomers(),
      adminRepository.getStores(),
      adminRepository.getDemoOrders(),
    ])
      .then(([riderRows, busy, demoCustomers, storeRows, demoOrders]) => {
        const demo: DemoRider[] = (riderRows as any[])
          .filter((r) => (r.profiles?.full_name ?? '').toLowerCase().includes('demo rider'))
          .map((r) => ({
            id: r.id, name: r.profiles?.full_name ?? 'Rider', phone: r.profiles?.phone ?? null,
            avatarUrl: r.profiles?.avatar_url ?? null, vehicleType: r.vehicle_type,
            storeId: r.primary_store_id ?? null, storeName: r.stores?.name ?? '—',
            isActive: r.is_active, isAvailable: r.is_available,
          }));
        setRiders(demo);
        setBusyRiderIds(busy);
        setCustomers(demoCustomers);
        const activeStores = (storeRows as any[]).filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name }));
        setStores(activeStores);
        setOrders(demoOrders);
        setSelectedStoreId((prev) => prev ?? activeStores[0]?.id ?? null);
        setSelectedCustomerId((prev) => prev ?? demoCustomers[0]?.id ?? null);
      })
      .catch(() => showToast("Couldn't load the QA panel.", 'error'))
      .finally(() => setLoading(false));
  }, [canManage, showToast]);

  useFocusEffect(load);

  const riderStatus = (r: DemoRider): 'busy' | 'available' | 'offline' => {
    if (busyRiderIds.has(r.id)) return 'busy';
    if (!r.isActive || !r.isAvailable) return 'offline';
    return 'available';
  };

  const toggleAvailability = async (r: DemoRider) => {
    setRiderActionId(r.id);
    try {
      await adminRepository.qaSetRiderAvailability(r.id, !r.isAvailable);
      showToast(`${r.name} is now ${!r.isAvailable ? 'available' : 'offline'}.`, 'success');
      load();
    } catch (e: any) {
      showToast(e?.message ?? "Couldn't update this rider.", 'error');
    } finally {
      setRiderActionId(null);
    }
  };

  const makeBusy = async (r: DemoRider) => {
    if (!selectedCustomerId) { showToast('No demo customer available.', 'error'); return; }
    setRiderActionId(r.id);
    try {
      const res = await adminRepository.qaMakeRiderBusy(r.id, selectedCustomerId);
      if (res.success) showToast(`${r.name} is now busy on a demo order.`, 'success');
      else showToast(res.message ?? "Couldn't create a demo delivery.", 'error');
      load();
    } catch (e: any) {
      showToast(e?.message ?? "Couldn't update this rider.", 'error');
    } finally {
      setRiderActionId(null);
    }
  };

  const clearBusy = async (r: DemoRider) => {
    setRiderActionId(r.id);
    try {
      await adminRepository.qaClearRiderBusy(r.id);
      showToast(`${r.name}'s demo delivery was cleared.`, 'success');
      load();
    } catch (e: any) {
      showToast(e?.message ?? "Couldn't clear this rider.", 'error');
    } finally {
      setRiderActionId(null);
    }
  };

  const createDemoOrder = async () => {
    if (!selectedStoreId || !selectedCustomerId) { showToast('Pick a store and a demo customer first.', 'error'); return; }
    setCreating(true);
    try {
      const res = await adminRepository.qaCreateDemoOrder(selectedCustomerId, selectedStoreId);
      if (res.success) showToast(`Demo order ${res.orderNumber} created (Ready for Pickup).`, 'success');
      else showToast(res.message ?? "Couldn't create a demo order.", 'error');
      load();
    } catch (e: any) {
      showToast(e?.message ?? "Couldn't create a demo order.", 'error');
    } finally {
      setCreating(false);
    }
  };

  const loadRound = useCallback(async (orderId: string) => {
    const round = await storeOpsRepository.getLatestDispatchRound(orderId);
    setRounds((prev) => ({ ...prev, [orderId]: round }));
    if (round) {
      const rows = await adminRepository.getDispatchOffersForRound(round.roundId);
      setOffers((prev) => ({ ...prev, [round.roundId]: rows }));
    }
  }, []);

  const toggleExpand = (orderId: string) => {
    const next = expandedOrderId === orderId ? null : orderId;
    setExpandedOrderId(next);
    if (next) loadRound(next);
  };

  const startDispatch = async (orderId: string) => {
    setOrderActionId(orderId);
    try {
      const res = await storeOpsRepository.startDispatchRound(orderId);
      if (res.success) showToast(`Sent to ${res.offerCount} eligible rider${res.offerCount === 1 ? '' : 's'}.`, 'success');
      else showToast(res.message ?? 'No eligible riders right now.', 'error');
      loadRound(orderId);
    } catch (e: any) {
      showToast(e?.message ?? "Couldn't start dispatch.", 'error');
    } finally {
      setOrderActionId(null);
    }
  };

  const expireRound = async (orderId: string, roundId: string) => {
    setOrderActionId(orderId);
    try {
      await adminRepository.qaExpireDispatchRound(roundId);
      showToast('Round expired — store will see "Rider Not Assigned".', 'success');
      loadRound(orderId);
    } catch (e: any) {
      showToast(e?.message ?? "Couldn't expire this round.", 'error');
    } finally {
      setOrderActionId(null);
    }
  };

  const simulateAccept = async (orderId: string, offerId: string) => {
    setOrderActionId(orderId);
    try {
      const res = await riderOpsRepository.acceptDeliveryOffer(offerId);
      showToast(res.success ? 'Offer accepted — this rider now has the delivery.' : (res.message ?? 'Accept failed.'), res.success ? 'success' : 'error');
      loadRound(orderId);
    } catch (e: any) {
      showToast(e?.message ?? 'Accept failed.', 'error');
    } finally {
      setOrderActionId(null);
    }
  };

  const simulateConcurrentAccept = async (orderId: string, offerAId: string, offerBId: string) => {
    setRacing(true);
    setOrderActionId(orderId);
    try {
      const [a, b] = await Promise.all([
        riderOpsRepository.acceptDeliveryOffer(offerAId),
        riderOpsRepository.acceptDeliveryOffer(offerBId),
      ]);
      const winners = [a, b].filter((r) => r.success).length;
      showToast(
        winners === 1 ? 'Race test passed: exactly one rider won.' : `Race test result: ${winners} winners (expected 1).`,
        winners === 1 ? 'success' : 'error',
      );
      loadRound(orderId);
    } catch (e: any) {
      showToast(e?.message ?? 'Race test failed.', 'error');
    } finally {
      setRacing(false);
      setOrderActionId(null);
    }
  };

  const resetDemoState = () => {
    Alert.alert(
      'Reset demo state?',
      'Cancels every still-open QA demo order and its dispatch rounds. Real customer orders are never touched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await adminRepository.qaResetDemoState();
              showToast(`Reset complete — ${res.cancelledOrders} demo order${res.cancelledOrders === 1 ? '' : 's'} cancelled.`, 'success');
              load();
            } catch (e: any) {
              showToast(e?.message ?? "Couldn't reset demo state.", 'error');
            }
          },
        },
      ],
    );
  };

  const openOffers = useMemo(() => {
    const map: Record<string, DemoOffer[]> = {};
    for (const [roundId, list] of Object.entries(offers)) map[roundId] = list.filter((o) => o.status === 'open');
    return map;
  }, [offers]);

  if (!canManage) {
    return (
      <AdminShell title="QA / Demo Panel">
        <View style={styles.centerFill}>
          <Text style={styles.deniedText}>You don't have permission to use the QA/demo tools.</Text>
        </View>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="QA / Demo Panel" subtitle="Simulate dispatch, riders, and orders for a live demo — never touches a real customer's order.">
      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Demo Riders</Text>
            <Text style={styles.cardHint}>Toggle availability, or give a rider a real active delivery so the eligibility rules have something to exclude.</Text>
            {riders.map((r) => {
              const status = riderStatus(r);
              const busy = riderActionId === r.id;
              return (
                <View key={r.id} style={styles.riderRow}>
                  <Avatar uri={r.avatarUrl} name={r.name} size="sm" />
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <Text style={styles.riderName}>{r.name}</Text>
                    <Text style={styles.riderMeta}>{r.vehicleType} • {r.storeName}</Text>
                  </View>
                  <StatusBadge status={status} size="sm" />
                  <View style={styles.riderActions}>
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: spacing.sm }} />
                    ) : status === 'busy' ? (
                      <Pressable style={styles.smallBtn} onPress={() => clearBusy(r)}>
                        <Text style={styles.smallBtnText}>Clear Busy</Text>
                      </Pressable>
                    ) : (
                      <>
                        <Pressable style={styles.smallBtn} onPress={() => toggleAvailability(r)}>
                          <Text style={styles.smallBtnText}>{r.isAvailable ? 'Go Offline' : 'Go Available'}</Text>
                        </Pressable>
                        {r.isAvailable && r.isActive && (
                          <Pressable style={styles.smallBtn} onPress={() => makeBusy(r)}>
                            <Text style={styles.smallBtnText}>Make Busy</Text>
                          </Pressable>
                        )}
                      </>
                    )}
                  </View>
                </View>
              );
            })}
            {riders.length === 0 && <Text style={styles.emptyText}>No demo riders found (looking for names containing "Demo Rider").</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create Demo Order</Text>
            <Text style={styles.cardHint}>Creates a real order for a demo customer and walks it straight to Ready for Pickup.</Text>
            <Text style={styles.pickerLabel}>Store</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {stores.map((s) => (
                <Pressable key={s.id} style={[styles.chip, selectedStoreId === s.id && styles.chipActive]} onPress={() => setSelectedStoreId(s.id)}>
                  <Text style={[styles.chipText, selectedStoreId === s.id && styles.chipTextActive]}>{s.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.pickerLabel}>Demo Customer</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {customers.map((c) => (
                <Pressable key={c.id} style={[styles.chip, selectedCustomerId === c.id && styles.chipActive]} onPress={() => setSelectedCustomerId(c.id)}>
                  <Text style={[styles.chipText, selectedCustomerId === c.id && styles.chipTextActive]}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.primaryBtn} onPress={createDemoOrder} disabled={creating}>
              {creating ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.primaryBtnText}>Create Demo Order</Text>}
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Demo Orders & Dispatch</Text>
            {orders.map((o) => {
              const expanded = expandedOrderId === o.id;
              const round = rounds[o.id];
              const roundOpen = round?.status === 'open';
              const roundOffers = round ? offers[round.roundId] ?? [] : [];
              const openList = round ? openOffers[round.roundId] ?? [] : [];
              const acting = orderActionId === o.id;
              return (
                <View key={o.id} style={styles.orderBlock}>
                  <Pressable style={styles.orderHeader} onPress={() => toggleExpand(o.id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orderNumber}>#{o.orderNumber}</Text>
                      <Text style={styles.riderMeta}>{o.storeName} • ₹{o.total.toFixed(0)}</Text>
                    </View>
                    <StatusBadge status={o.status} size="sm" />
                    {expanded ? <ChevronUp size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} /> : <ChevronDown size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />}
                  </Pressable>
                  {expanded && (
                    <View style={styles.orderDetail}>
                      {o.status === 'packed' && !round && (
                        <Pressable style={styles.primaryBtnSmall} onPress={() => startDispatch(o.id)} disabled={acting}>
                          {acting ? <ActivityIndicator size="small" color={colors.white} /> : (
                            <>
                              <Send size={14} color={colors.white} strokeWidth={ICON_STROKE} />
                              <Text style={styles.primaryBtnText}>Send Rider</Text>
                            </>
                          )}
                        </Pressable>
                      )}
                      {round && (
                        <>
                          <Text style={styles.roundLabel}>Round #{round.roundNumber} — {round.status.toUpperCase()}</Text>
                          {roundOffers.map((off) => (
                            <View key={off.offerId} style={styles.offerRow}>
                              <Text style={styles.offerName} numberOfLines={1}>{off.riderName}</Text>
                              <StatusBadge status={off.status} size="sm" />
                              {off.status === 'open' && (
                                <Pressable style={styles.tinyBtn} onPress={() => simulateAccept(o.id, off.offerId)} disabled={acting}>
                                  <Text style={styles.tinyBtnText}>Simulate Accept</Text>
                                </Pressable>
                              )}
                            </View>
                          ))}
                          {roundOpen && (
                            <View style={styles.roundActions}>
                              {openList.length >= 2 && (
                                <Pressable
                                  style={styles.raceBtn}
                                  onPress={() => simulateConcurrentAccept(o.id, openList[0]!.offerId, openList[1]!.offerId)}
                                  disabled={racing}
                                >
                                  <Zap size={14} color={colors.white} strokeWidth={ICON_STROKE} />
                                  <Text style={styles.primaryBtnText}>{racing ? 'Racing…' : 'Simulate Concurrent Accept'}</Text>
                                </Pressable>
                              )}
                              <Pressable style={styles.smallBtn} onPress={() => expireRound(o.id, round.roundId)} disabled={acting}>
                                <Text style={styles.smallBtnText}>Expire Round Now</Text>
                              </Pressable>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
            {orders.length === 0 && <Text style={styles.emptyText}>No demo orders yet — create one above.</Text>}
          </View>

          <View style={[styles.card, styles.dangerCard]}>
            <Text style={styles.cardTitle}>Reset Demo State</Text>
            <Text style={styles.cardHint}>Cancels only orders this panel created. Real customer orders, rider availability, and inventory outside of QA orders are never touched.</Text>
            <Pressable style={styles.dangerBtn} onPress={resetDemoState}>
              <RotateCcw size={14} color={colors.error} strokeWidth={ICON_STROKE} />
              <Text style={styles.dangerBtnText}>Reset Demo State</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  deniedText: { ...textStyles.bodySmall, color: colors.textSecondary, textAlign: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, maxWidth: 720, width: '100%', alignSelf: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  dangerCard: { borderColor: colors.errorTint },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  cardHint: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md, lineHeight: 16 },
  emptyText: { ...textStyles.caption, color: colors.textMuted },
  riderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, flexWrap: 'wrap' },
  riderName: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  riderMeta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  riderActions: { flexDirection: 'row', gap: spacing.xs, marginLeft: spacing.sm },
  smallBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { ...textStyles.caption, fontSize: 11, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  pickerLabel: { ...textStyles.caption, color: colors.textMuted, marginTop: spacing.xs, marginBottom: 4 },
  chipRow: { gap: spacing.xs, paddingBottom: 2 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.divider },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...textStyles.caption, color: colors.textSecondary },
  chipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  primaryBtn: { marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtnSmall: { flexDirection: 'row', gap: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  primaryBtnText: { ...textStyles.bodySmall, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  orderBlock: { borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.sm },
  orderHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  orderNumber: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  orderDetail: { marginTop: spacing.sm, paddingLeft: spacing.xs, gap: spacing.xs },
  roundLabel: { ...textStyles.caption, color: colors.textMuted, marginBottom: 2 },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  offerName: { ...textStyles.caption, color: colors.textPrimary, flex: 1 },
  tinyBtn: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.primaryTint },
  tinyBtnText: { ...textStyles.caption, fontSize: 10.5, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  roundActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  raceBtn: { flexDirection: 'row', gap: 6, backgroundColor: colors.goldDark, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  dangerBtn: { flexDirection: 'row', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.error, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: spacing.md, alignItems: 'center' },
  dangerBtnText: { ...textStyles.bodySmall, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
});
