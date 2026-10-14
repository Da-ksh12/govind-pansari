import React from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Clock, Navigation, Phone, Store as StoreIcon } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { EmptyState } from '../components/ui/EmptyState';
import { storeRepository } from '../services/repositories/storeRepository';
import { useAsync } from '../hooks/useAsync';
import { useLocationStore } from '../store/locationStore';
import { haversineKm } from '../services/geo';

export default function StoreLocatorScreen() {
  const selected = useLocationStore((s) => s.selected);
  const { data: stores, loading, error, reload } = useAsync(() => storeRepository.list(), []);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Store Locator</Text>
          <Text style={styles.headerSubtitle}>Govind Pansari outlets near you</Text>
        </View>
      </View>

      {loading && (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!loading && error && (
        <EmptyState
          icon={StoreIcon}
          title="Couldn't load stores"
          subtitle={error.message || 'Please check your connection and try again.'}
          ctaLabel="Retry"
          onPressCta={reload}
        />
      )}

      {!loading && !error && stores && stores.length === 0 && (
        <EmptyState icon={StoreIcon} title="No stores found" subtitle="Please check back later." />
      )}

      {!loading && !error && stores && stores.length > 0 && (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {stores.map((store) => {
          const distance = selected ? haversineKm(selected.position, { lat: store.lat, lng: store.lng }).toFixed(1) : null;
          return (
            <View key={store.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.iconCircle}>
                  <StoreIcon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName}>{store.name}</Text>
                  <Text style={styles.storeAddress}>
                    {store.addressLine}, {store.city}
                  </Text>
                </View>
                <View style={[styles.statusChip, store.isOpen ? styles.statusOpen : styles.statusClosed]}>
                  <Text style={[styles.statusText, { color: store.isOpen ? colors.success : colors.error }]}>
                    {store.isOpen ? 'Open' : 'Closed'}
                  </Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Clock size={ICON_SIZE.xs} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.metaText}>
                    {store.openTime} – {store.closeTime}
                  </Text>
                </View>
                {distance && (
                  <View style={styles.metaItem}>
                    <Navigation size={ICON_SIZE.xs} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                    <Text style={styles.metaText}>{distance} km away</Text>
                  </View>
                )}
              </View>

              <View style={styles.actionsRow}>
                <Pressable style={styles.actionBtn} onPress={() => Linking.openURL(`tel:${store.phone}`).catch(() => {})}>
                  <Phone size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.actionBtnText}>Call</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                  onPress={() =>
                    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${store.lat},${store.lng}`).catch(() => {})
                  }
                >
                  <Navigation size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
                  <Text style={[styles.actionBtnText, { color: colors.white }]}>Directions</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, ...shadows.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  storeName: { ...textStyles.cardTitle, color: colors.textPrimary },
  storeAddress: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  statusChip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusOpen: { backgroundColor: colors.successTint },
  statusClosed: { backgroundColor: colors.errorTint },
  statusText: { fontSize: 10.5, fontFamily: 'PlusJakartaSans_700Bold' },
  metaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...textStyles.caption, color: colors.textSecondary },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.primary },
  actionBtnPrimary: { backgroundColor: colors.primary },
  actionBtnText: { ...textStyles.button, color: colors.primary, fontSize: 13 },
});
