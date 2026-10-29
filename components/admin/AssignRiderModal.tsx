import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { formatINR } from '../ui/PriceBlock';
import { RiderDidNotAcceptNotice } from '../dispatch/RiderDidNotAcceptNotice';
import { RiderPickerList } from '../dispatch/RiderPickerList';
import { storeOpsRepository, type AssignableRider } from '../../services/repositories/storeOpsRepository';
import { describeAssignmentError } from '../../services/assignmentErrors';
import { unansweredAttempt, type RiderAttempt } from '../../services/riderAssignment';
import { useUIStore } from '../../store/uiStore';

/** The little an assignment needs to know about the order — satisfied by an admin order row and by a delivery's order. */
export interface AssignableOrder {
  id: string;
  order_number: string;
  store_name: string;
  total: number;
}

interface Props {
  order: AssignableOrder | null;
  onClose: () => void;
  /** Called after any change that makes the caller's list stale (a rider was assigned, or the order turned out to be gone). */
  onChanged: () => void;
}

/**
 * Admin rider assignment for one ready order — always by choosing a rider; there is no automatic assignment.
 * It uses the same server functions the store app uses (get_riders_for_assignment, assign_rider), which already
 * authorise admins and re-check, under row locks, that the order is still packed, the rider is active, available
 * and under capacity — so two admins racing for the same order cannot both succeed. This screen only presents the
 * choice (every rider with a free / delivering / offline status) and reports the outcome.
 */
export function AssignRiderModal({ order, onClose, onChanged }: Props) {
  const showToast = useUIStore((s) => s.showToast);
  const [riders, setRiders] = useState<AssignableRider[]>([]);
  const [attempts, setAttempts] = useState<RiderAttempt[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyRiderId, setBusyRiderId] = useState<string | null>(null);

  const orderId = order?.id ?? null;

  const loadRiders = useCallback(() => {
    if (!orderId) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([storeOpsRepository.getRidersForAssignment(orderId), storeOpsRepository.getOrderRiderAttempts(orderId).catch(() => [] as RiderAttempt[])])
      .then(([list, history]) => {
        setRiders(list);
        setAttempts(history);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[assign rider] riders failed to load:', e instanceof Error ? e.message : e);
        setRiders([]);
        setLoadError(describeAssignmentError(e).message);
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    setActionError(null);
    setBusyRiderId(null);
    if (orderId) loadRiders();
  }, [orderId, loadRiders]);

  const fail = (e: unknown) => {
    const failure = describeAssignmentError(e);
    setActionError(failure.message);
    if (failure.refresh) {
      onChanged();
      onClose();
    } else {
      loadRiders();
    }
  };

  const assign = async (rider: AssignableRider) => {
    if (!order || busyRiderId) return;
    setBusyRiderId(rider.riderId);
    setActionError(null);
    try {
      await storeOpsRepository.assignRider(order.id, rider.riderId);
      showToast(`Order #${order.order_number} sent to ${rider.name}. They have 5 minutes to accept.`, 'success');
      onChanged();
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusyRiderId(null);
    }
  };

  const notAccepted = unansweredAttempt(attempts, false);

  return (
    <Modal visible={!!order} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Choose a rider</Text>
              {order && (
                <Text style={styles.subtitle}>
                  #{order.order_number} • {order.store_name.replace('Govind Pansari — ', '')} • {formatINR(order.total)}
                </Text>
              )}
            </View>
            <Pressable onPress={loadRiders} hitSlop={10} disabled={loading} accessibilityLabel="Refresh riders">
              <Text style={styles.link}>Refresh</Text>
            </Pressable>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <X size={ICON_SIZE.md} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            </Pressable>
          </View>

          {notAccepted && <RiderDidNotAcceptNotice attempt={notAccepted} />}
          {actionError && <Text style={styles.errorText}>{actionError}</Text>}

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: spacing.sm }}>
            <RiderPickerList riders={riders} loading={loading} error={loadError} onRetry={loadRiders} busyRiderId={busyRiderId} onPick={assign} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 520, maxHeight: '88%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, ...shadows.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  subtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  list: { flexGrow: 0 },
  errorText: { ...textStyles.bodySmall, color: colors.error, textAlign: 'center' },
  link: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
});
