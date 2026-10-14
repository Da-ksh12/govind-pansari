import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Briefcase, Check, Home, MapPin, Plus, Trash2 } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { EmptyState } from '../components/ui/EmptyState';
import { addressRepository } from '../services/repositories/addressRepository';
import type { Address } from '../types/models';

const LABEL_ICON = { home: Home, work: Briefcase, other: MapPin } as const;

export default function AddressScreen() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    addressRepository
      .list()
      .then(setAddresses)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const handleSetDefault = async (id: string) => {
    setBusyId(id);
    try {
      await addressRepository.setDefault(id);
      load();
    } catch {
      Alert.alert('Something went wrong', "Couldn't update your default address. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (addr: Address) => {
    Alert.alert('Remove address', `Remove "${addr.line1}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusyId(addr.id);
          try {
            await addressRepository.remove(addr.id);
            load();
          } catch {
            Alert.alert('Something went wrong', "Couldn't remove this address. Please try again.");
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>Saved Addresses</Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <EmptyState title="Couldn't load your addresses" subtitle="Check your connection and try again." ctaLabel="Retry" onPressCta={load} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {addresses.length === 0 && (
            <EmptyState icon={MapPin} title="No saved addresses yet" subtitle="Add an address to make checkout faster." />
          )}
          {addresses.map((addr) => {
            const Icon = LABEL_ICON[addr.label];
            const busy = busyId === addr.id;
            return (
              <Pressable
                key={addr.id}
                style={styles.card}
                onPress={() => !addr.isDefault && handleSetDefault(addr.id)}
                disabled={busy}
              >
                <View style={styles.iconCircle}>
                  <Icon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>{addr.label === 'home' ? 'Home' : addr.label === 'work' ? 'Work' : 'Other'}</Text>
                    {addr.isDefault && (
                      <View style={styles.defaultChip}>
                        <Check size={10} color={colors.success} strokeWidth={ICON_STROKE} />
                        <Text style={styles.defaultChipText}>Default</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.line}>
                    {addr.line1}
                    {addr.line2 ? `, ${addr.line2}` : ''}, {addr.city}, {addr.state} - {addr.pincode}
                  </Text>
                  <Text style={styles.receiver}>
                    {addr.receiverName} • {addr.receiverPhone}
                  </Text>
                </View>
                {busy ? (
                  <ActivityIndicator color={colors.textMuted} size="small" />
                ) : (
                  <Pressable hitSlop={8} onPress={() => handleDelete(addr)}>
                    <Trash2 size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
                  </Pressable>
                )}
              </Pressable>
            );
          })}

          <Pressable style={styles.addBtn} onPress={() => router.push('/address/add')}>
            <Plus size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.addBtnText}>Add New Address</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl },
  card: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, alignItems: 'center', ...shadows.sm },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...textStyles.cardTitle, color: colors.textPrimary },
  defaultChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.successTint, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  defaultChipText: { fontSize: 10, color: colors.success, fontFamily: 'PlusJakartaSans_700Bold' },
  line: { ...textStyles.bodySmall, color: colors.textSecondary, marginTop: 3, lineHeight: 19 },
  receiver: { ...textStyles.caption, color: colors.textMuted, marginTop: 4 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    height: 52,
    marginTop: spacing.sm,
  },
  addBtnText: { ...textStyles.button, color: colors.primary, fontSize: 14 },
});
