import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ScrollText } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { AdminShell } from '../../components/admin/AdminShell';
import { EmptyState } from '../../components/ui/EmptyState';
import { adminRepository, type AuditLogRow } from '../../services/repositories/adminRepository';

export default function AdminAuditLogsScreen() {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminRepository.getAuditLogs(undefined, 30).then((rows) => {
      setLogs(rows);
      setHasMore(rows.length === 30);
    }).catch(() => setLogs([])).finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const loadMore = () => {
    if (!hasMore || loadingMore || logs.length === 0) return;
    setLoadingMore(true);
    adminRepository.getAuditLogs(logs[logs.length - 1].created_at, 30).then((rows) => {
      setLogs((prev) => [...prev, ...rows]);
      setHasMore(rows.length === 30);
    }).catch(() => {}).finally(() => setLoadingMore(false));
  };

  return (
    <AdminShell title="Audit Logs" subtitle="A record of every sensitive action taken in the admin panel">
      <FlatList
        style={{ flex: 1 }}
        data={logs}
        keyExtractor={(l) => l.id}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <EmptyState icon={ScrollText} title="No activity yet" subtitle="Sensitive admin actions will appear here as they happen." /> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} /> : null}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.time}>
              {new Date(item.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.action}>
                <Text style={styles.actor}>{item.actor_name ?? 'System'}</Text> {item.action.replace(/_/g, ' ')} <Text style={styles.resource}>{item.resource_type}</Text>
              </Text>
              {Object.keys(item.metadata ?? {}).length > 0 && (
                <Text style={styles.metadata} numberOfLines={2}>{JSON.stringify(item.metadata)}</Text>
              )}
            </View>
          </View>
        )}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, gap: spacing.xs, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  time: { ...textStyles.caption, color: colors.textMuted, width: 100 },
  action: { ...textStyles.bodySmall, color: colors.textPrimary },
  actor: { fontFamily: 'PlusJakartaSans_700Bold', color: colors.textPrimary },
  resource: { color: colors.textSecondary },
  metadata: { ...textStyles.caption, color: colors.textMuted, marginTop: 2, fontFamily: 'PlusJakartaSans_400Regular' },
});
