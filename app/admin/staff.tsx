import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Mail, UserPlus, Users } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository, type AdminRoleType, type AdminStaffInviteRow } from '../../services/repositories/adminRepository';

const ADMIN_SUB_ROLES: AdminRoleType[] = ['operations_manager', 'inventory_manager', 'delivery_manager', 'support_agent'];
const INVITE_ROLES: { key: 'store_manager' | 'staff' | 'rider'; label: string }[] = [
  { key: 'store_manager', label: 'Store Manager' },
  { key: 'staff', label: 'Store Staff' },
  { key: 'rider', label: 'Rider' },
];

export default function AdminStaffScreen() {
  const [staff, setStaff] = useState<any[]>([]);
  const [invites, setInvites] = useState<AdminStaffInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const context = useAdminStore((s) => s.context);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);

  const canInvite = hasPermission('users.manage') || hasPermission('riders.manage');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      adminRepository.getStaffList().catch(() => []),
      canInvite ? adminRepository.getStaffInvites().catch(() => []) : Promise.resolve([]),
    ])
      .then(([s, i]) => {
        setStaff(s);
        setInvites(i);
      })
      .finally(() => setLoading(false));
  }, [canInvite]);

  useFocusEffect(load);

  return (
    <AdminShell title="Staff & Roles" subtitle="Manage admin permissions and invite your team">
      <View style={styles.toolbar}>
        {hasPermission('users.manage') && (
          <Pressable style={styles.addBtn} onPress={() => setShowAssign(true)}>
            <UserPlus size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            <Text style={styles.addBtnText}>Assign Admin Role</Text>
          </Pressable>
        )}
        {canInvite && (
          <Pressable style={styles.addBtnOutline} onPress={() => setShowInvite(true)}>
            <Mail size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.addBtnOutlineText}>Invite Rider / Store Manager</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={staff}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          canInvite && invites.length > 0 ? (
            <View style={styles.invitesSection}>
              <Text style={styles.sectionLabel}>Pending Invites</Text>
              {invites.filter((i) => !i.applied_at).map((inv) => (
                <View key={inv.id} style={styles.inviteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{inv.full_name}</Text>
                    <Text style={styles.meta}>{inv.email} • {inv.role.replace('_', ' ')}{inv.store_name ? ` • ${inv.store_name}` : ''}</Text>
                  </View>
                  <StatusBadge status="pending" size="sm" />
                </View>
              ))}
              <Text style={styles.sectionLabel}>Staff &amp; Admins</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={!loading ? <EmptyState icon={Users} title="No staff or admin accounts yet" /> : null}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1.2 }}>
              <Text style={styles.name}>{item.full_name ?? 'Unnamed'}</Text>
              <Text style={styles.meta}>{item.phone}</Text>
            </View>
            <View style={[styles.roleBadge, item.role === 'admin' && styles.roleBadgeAdmin]}>
              <Text style={[styles.roleBadgeText, item.role === 'admin' && { color: colors.primary }]}>
                {item.role === 'admin' ? (item.admin_role?.replace(/_/g, ' ') ?? 'super admin') : item.role.replace(/_/g, ' ')}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              {item.store_assignments?.map((s: any) => (
                <Text key={s.storeId} style={styles.meta}>{s.storeName}</Text>
              ))}
            </View>
          </View>
        )}
      />

      {showAssign && (
        <AssignRoleModal
          canGrantHighTier={context?.isSuperAdmin ?? false}
          onClose={() => setShowAssign(false)}
          onDone={() => { setShowAssign(false); load(); }}
          showToast={showToast}
        />
      )}
      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onDone={() => { setShowInvite(false); load(); }}
          showToast={showToast}
        />
      )}
    </AdminShell>
  );
}

function AssignRoleModal({ canGrantHighTier, onClose, onDone, showToast }: { canGrantHighTier: boolean; onClose: () => void; onDone: () => void; showToast: (m: string, v: 'success' | 'error' | 'info') => void }) {
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AdminRoleType>('support_agent');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!phone.trim()) return;
    setSaving(true);
    try {
      await adminRepository.assignAdminRole(phone.trim(), role);
      showToast('Role assigned.', 'success');
      onDone();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't assign this role.", 'error');
    } finally {
      setSaving(false);
    }
  };

  const options = canGrantHighTier ? (['admin', ...ADMIN_SUB_ROLES] as AdminRoleType[]) : ADMIN_SUB_ROLES;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.modalOverlay} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Assign Admin Role</Text>
            <Text style={styles.modalSubtitle}>The person must already have a Govind Pansari account (they've signed up at least once).</Text>
            <TextInput style={styles.modalInput} placeholder="Phone number (e.g. +919876543210)" placeholderTextColor={colors.textMuted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <View style={styles.roleOptions}>
              {options.map((r) => (
                <Pressable key={r} style={[styles.roleOption, role === r && styles.roleOptionActive]} onPress={() => setRole(r)}>
                  <Text style={[styles.roleOptionText, role === r && styles.roleOptionTextActive]}>{r.replace(/_/g, ' ')}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={submit} disabled={saving || !phone.trim()}>
                <Text style={styles.modalSaveText}>{saving ? 'Saving…' : 'Assign'}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InviteModal({ onClose, onDone, showToast }: { onClose: () => void; onDone: () => void; showToast: (m: string, v: 'success' | 'error' | 'info') => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'store_manager' | 'staff' | 'rider'>('rider');
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState('scooter');
  const [saving, setSaving] = useState(false);
  const hasPermission = useAdminStore((s) => s.hasPermission);

  useEffect(() => {
    adminRepository.getStores().then((s) => setStores((s as any[]).filter((x) => x.is_active))).catch(() => {});
  }, []);

  const needsStore = role === 'store_manager' || role === 'staff';
  const canSubmit = email.trim() && fullName.trim() && (!needsStore || storeId) && !saving;
  const availableRoles = INVITE_ROLES.filter((r) => (r.key === 'rider' ? hasPermission('riders.manage') : hasPermission('users.manage')));

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const { inviteId } = await adminRepository.createStaffInvite({
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        role,
        storeId: needsStore ? storeId! : undefined,
        vehicleType: role === 'rider' ? vehicleType : undefined,
      });
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/staff-invite-accept` : undefined;
      await adminRepository.sendStaffInviteEmail(inviteId, redirectTo);
      showToast(`Invite sent to ${email.trim()}.`, 'success');
      onDone();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't send the invite.", 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.modalOverlay} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Invite Rider / Store Manager</Text>
            <Text style={styles.modalSubtitle}>They'll get a real email with a link to set their password and sign in.</Text>

            <TextInput style={styles.modalInput} placeholder="Full name" placeholderTextColor={colors.textMuted} value={fullName} onChangeText={setFullName} />
            <TextInput style={[styles.modalInput, { marginTop: spacing.sm }]} placeholder="Email address" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.roleOptions}>
              {availableRoles.map((r) => (
                <Pressable key={r.key} style={[styles.roleOption, role === r.key && styles.roleOptionActive]} onPress={() => setRole(r.key)}>
                  <Text style={[styles.roleOptionText, role === r.key && styles.roleOptionTextActive]}>{r.label}</Text>
                </Pressable>
              ))}
            </View>

            {needsStore && (
              <>
                <Text style={styles.fieldLabel}>Store</Text>
                <View style={styles.roleOptions}>
                  {stores.map((s) => (
                    <Pressable key={s.id} style={[styles.roleOption, storeId === s.id && styles.roleOptionActive]} onPress={() => setStoreId(s.id)}>
                      <Text style={[styles.roleOptionText, storeId === s.id && styles.roleOptionTextActive]}>{s.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {role === 'rider' && (
              <>
                <Text style={styles.fieldLabel}>Vehicle type</Text>
                <View style={styles.roleOptions}>
                  {['scooter', 'bike', 'bicycle'].map((v) => (
                    <Pressable key={v} style={[styles.roleOption, vehicleType === v && styles.roleOptionActive]} onPress={() => setVehicleType(v)}>
                      <Text style={[styles.roleOptionText, vehicleType === v && styles.roleOptionTextActive]}>{v}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={submit} disabled={!canSubmit}>
                {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.modalSaveText}>Send Invite</Text>}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  addBtnText: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  addBtnOutline: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  addBtnOutlineText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  listContent: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  invitesSection: { marginBottom: spacing.sm },
  sectionLabel: { ...textStyles.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.sm, marginTop: spacing.sm },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  name: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  roleBadge: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  roleBadgeAdmin: { backgroundColor: colors.primaryTint },
  roleBadgeText: { ...textStyles.caption, color: colors.textSecondary, fontSize: 10.5, textTransform: 'capitalize' },
  modalOverlay: { flexGrow: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 440, maxHeight: '86%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...shadows.lg },
  modalTitle: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  modalSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 },
  modalInput: { backgroundColor: colors.surfaceSunken, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 42, ...textStyles.bodySmall, color: colors.textPrimary },
  roleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roleOption: { paddingHorizontal: spacing.sm, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  roleOptionActive: { backgroundColor: colors.primary },
  roleOptionText: { ...textStyles.caption, color: colors.textSecondary, fontSize: 11, textTransform: 'capitalize' },
  roleOptionTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
