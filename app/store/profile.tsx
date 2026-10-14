import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Clock, LogOut, MapPin, Phone, Store, Users } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../../components/layout/SafeBottomSpacer';
import { useAuthStore } from '../../store/authStore';
import { useStoreOpsStore } from '../../store/storeOpsStore';
import { storeOpsRepository, type StaffMember, type StoreProfile } from '../../services/repositories/storeOpsRepository';

export default function StoreProfileScreen() {
  const profile = useAuthStore((s) => s.profile);
  const logout = useAuthStore((s) => s.logout);
  const activeStoreId = useStoreOpsStore((s) => s.activeStoreId);
  const myStores = useStoreOpsStore((s) => s.myStores);
  const staffRole = myStores.find((s) => s.storeId === activeStoreId)?.staffRole;

  const [store, setStore] = useState<StoreProfile | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!activeStoreId) return;
    setLoading(true);
    Promise.all([storeOpsRepository.getStoreProfile(activeStoreId), storeOpsRepository.listStaff(activeStoreId)])
      .then(([s, st]) => {
        setStore(s);
        setStaff(st);
      })
      .finally(() => setLoading(false));
  }, [activeStoreId]);

  useFocusEffect(load);

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Store</Text>
      </View>

      {loading && !store ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.profileCard}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{profile?.name?.[0]?.toUpperCase() ?? 'S'}</Text>
            </View>
            <Text style={styles.name}>{profile?.name}</Text>
            <Text style={styles.roleTag}>{staffRole === 'store_manager' ? 'Store Manager' : 'Store Staff'}</Text>
            <Text style={styles.phone}>{profile?.phone}</Text>
          </View>

          {store && (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Store size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>{store.name}</Text>
              </View>
              <View style={styles.infoRow}>
                <MapPin size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                <Text style={styles.infoText}>{store.addressLine}, {store.city}</Text>
              </View>
              {store.phone && (
                <View style={styles.infoRow}>
                  <Phone size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.infoText}>{store.phone}</Text>
                </View>
              )}
              <View style={styles.infoRow}>
                <Clock size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                <Text style={styles.infoText}>{store.openingTime.slice(0, 5)} – {store.closingTime.slice(0, 5)}</Text>
              </View>
              <View style={styles.chipsRow}>
                <View style={[styles.chip, { backgroundColor: store.isActive ? colors.successTint : colors.errorTint }]}>
                  <Text style={[styles.chipText, { color: store.isActive ? colors.success : colors.error }]}>{store.isActive ? 'Active' : 'Inactive'}</Text>
                </View>
                <View style={[styles.chip, { backgroundColor: store.isAcceptingOrders ? colors.successTint : colors.warningTint }]}>
                  <Text style={[styles.chipText, { color: store.isAcceptingOrders ? colors.success : colors.warning }]}>
                    {store.isAcceptingOrders ? 'Accepting Orders' : 'Paused'}
                  </Text>
                </View>
              </View>
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Users size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.cardTitle}>Team ({staff.length})</Text>
            </View>
            {staff.map((member) => (
              <View key={member.id} style={styles.staffRow}>
                <Text style={styles.staffName}>{member.name}</Text>
                <Text style={styles.staffRole}>{member.role === 'store_manager' ? 'Manager' : 'Staff'}</Text>
              </View>
            ))}
          </View>

          <Pressable style={styles.logoutBtn} onPress={handleLogout}>
            <LogOut size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
            <Text style={styles.logoutText}>Log Out</Text>
          </Pressable>

          <SafeBottomSpacer />
        </ScrollView>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  profileCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md, ...shadows.sm },
  avatarCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  avatarInitial: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.primary },
  name: { ...textStyles.cardTitle, fontSize: 18, color: colors.textPrimary },
  roleTag: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold', marginTop: 2 },
  phone: { ...textStyles.caption, color: colors.textSecondary, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, ...shadows.sm },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { ...textStyles.cardTitle, color: colors.textPrimary },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  infoText: { ...textStyles.caption, color: colors.textSecondary },
  chipsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  chipText: { fontSize: 10.5, fontFamily: 'PlusJakartaSans_700Bold' },
  staffRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.divider },
  staffName: { ...textStyles.bodySmall, color: colors.textPrimary },
  staffRole: { ...textStyles.caption, color: colors.textSecondary },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.md, height: 52 },
  logoutText: { ...textStyles.button, color: colors.error, fontSize: 15 },
});
