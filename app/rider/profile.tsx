import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { Bell, BellOff, LogOut, Phone, Store, Truck } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../../components/layout/SafeBottomSpacer';
import { useAuthStore } from '../../store/authStore';
import { riderOpsRepository, type RiderProfile } from '../../services/repositories/riderOpsRepository';

export default function RiderProfileScreen() {
  const profile = useAuthStore((s) => s.profile);
  const logout = useAuthStore((s) => s.logout);
  const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifStatus, setNotifStatus] = useState<Notifications.PermissionStatus | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    riderOpsRepository
      .getRiderProfile()
      .then(setRiderProfile)
      .catch(() => setRiderProfile(null))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  // Re-checked every time this screen gains focus — the only way to
  // notice a rider granted/revoked notification permission in OS
  // Settings and came back (there's no permission-change event to
  // listen for). This is the ONE thing standing between a "New
  // Delivery" push actually reaching this rider or silently vanishing.
  useFocusEffect(
    useCallback(() => {
      Notifications.getPermissionsAsync()
        .then((res) => setNotifStatus(res.status))
        .catch(() => setNotifStatus(null));
    }, []),
  );

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.profileCard}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{profile?.name?.[0]?.toUpperCase() ?? 'R'}</Text>
            </View>
            <Text style={styles.name}>{profile?.name}</Text>
            <Text style={styles.roleTag}>Delivery Rider</Text>
          </View>

          {notifStatus != null && notifStatus !== 'granted' && (
            <View style={styles.notifAlertCard}>
              <View style={styles.notifAlertIconCircle}>
                <BellOff size={ICON_SIZE.md} color={colors.error} strokeWidth={ICON_STROKE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.notifAlertTitle}>Delivery Alerts</Text>
                <Text style={styles.notifAlertBody}>
                  Notifications are currently disabled. Enable notifications to receive new delivery alerts immediately.
                </Text>
                <Pressable style={styles.notifAlertBtn} onPress={() => Linking.openSettings()}>
                  <Bell size={14} color={colors.white} strokeWidth={ICON_STROKE} />
                  <Text style={styles.notifAlertBtnText}>Open Notification Settings</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.infoRow}>
              <Phone size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              <Text style={styles.infoText}>{profile?.phone}</Text>
            </View>
            {riderProfile && (
              <>
                <View style={styles.infoRow}>
                  <Truck size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.infoText}>
                    {riderProfile.vehicleType.charAt(0).toUpperCase() + riderProfile.vehicleType.slice(1)}
                    {riderProfile.vehicleNumber ? ` • ${riderProfile.vehicleNumber}` : ''}
                  </Text>
                </View>
                {riderProfile.primaryStoreName && (
                  <View style={styles.infoRow}>
                    <Store size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                    <Text style={styles.infoText}>{riderProfile.primaryStoreName}</Text>
                  </View>
                )}
              </>
            )}
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
  notifAlertCard: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.errorTint,
    borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.error,
  },
  notifAlertIconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  notifAlertTitle: { ...textStyles.cardTitle, fontSize: 15, color: colors.textPrimary },
  notifAlertBody: { ...textStyles.bodySmall, color: colors.textSecondary, marginTop: 2 },
  notifAlertBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.error, borderRadius: radius.sm, height: 38, marginTop: spacing.sm },
  notifAlertBtnText: { ...textStyles.button, color: colors.white, fontSize: 12.5 },
  avatarCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  avatarInitial: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.primary },
  name: { ...textStyles.cardTitle, fontSize: 18, color: colors.textPrimary },
  roleTag: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold', marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, ...shadows.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  infoText: { ...textStyles.bodySmall, color: colors.textSecondary },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.md, height: 52 },
  logoutText: { ...textStyles.button, color: colors.error, fontSize: 15 },
});
