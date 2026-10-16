import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ImagePlus, Pencil, Plus, Tag, X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { AppImage } from '../../components/ui/AppImage';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository, type AdminCategoryInput } from '../../services/repositories/adminRepository';
import { pickProductImage, uploadProductImage, ImageUploadError } from '../../services/storage/productImages';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';

interface CategoryRow {
  id: string; name: string; slug: string; description: string | null; image_url: string | null;
  parent_id: string | null; sort_order: number; is_active: boolean;
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export default function AdminCategoriesScreen() {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CategoryRow | 'new' | null>(null);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);
  const canManage = hasPermission('categories.manage');

  const load = useCallback(() => {
    setLoading(true);
    adminRepository.getCategories().then((c) => setCategories(c as CategoryRow[])).catch(() => setCategories([])).finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);
  useEffect(() => adminRepository.subscribeToAdminCatalogue(load), [load]);
  useRefetchOnForeground(load);

  const toggleActive = async (cat: CategoryRow) => {
    const next = !cat.is_active;
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, is_active: next } : c)));
    try {
      await adminRepository.setCategoryActive(cat.id, next);
    } catch {
      setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, is_active: !next } : c)));
      showToast("Couldn't update the category.", 'error');
    }
  };

  const byParent = new Map<string | null, CategoryRow[]>();
  for (const c of categories) {
    const key = c.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  const sortByOrder = (a: CategoryRow, b: CategoryRow) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  const hierarchical: CategoryRow[] = [];
  for (const top of (byParent.get(null) ?? []).sort(sortByOrder)) {
    hierarchical.push(top);
    for (const child of (byParent.get(top.id) ?? []).sort(sortByOrder)) hierarchical.push(child);
  }

  return (
    <AdminShell title="Categories" subtitle="Organize your catalogue into browsable groups">
      {canManage && (
        <View style={styles.toolbar}>
          <Pressable style={styles.addBtn} onPress={() => setEditing('new')}>
            <Plus size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            <Text style={styles.addBtnText}>Add Category</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        style={{ flex: 1 }}
        data={hierarchical}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <EmptyState icon={Tag} title="No categories" subtitle="Add your first category to start organizing products." /> : null}
        renderItem={({ item }) => (
          <View style={[styles.row, !!item.parent_id && styles.rowChild]}>
            <AppImage uri={item.image_url} style={styles.thumb} contentFit="cover" fallbackIcon={Tag} fallbackIconSize={ICON_SIZE.xs} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              {item.description ? <Text style={styles.description} numberOfLines={1}>{item.description}</Text> : null}
            </View>
            <StatusBadge status={item.is_active ? 'active' : 'inactive'} size="sm" />
            {canManage && (
              <Pressable style={styles.editBtn} onPress={() => setEditing(item)} hitSlop={8}>
                <Pencil size={ICON_SIZE.xs} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              </Pressable>
            )}
            {canManage && (
              <Switch value={item.is_active} onValueChange={() => toggleActive(item)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
            )}
          </View>
        )}
      />

      {editing && (
        <CategoryEditor
          category={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          showToast={showToast}
        />
      )}
    </AdminShell>
  );
}

function CategoryEditor({
  category, categories, onClose, onSaved, showToast,
}: {
  category: CategoryRow | null;
  categories: CategoryRow[];
  onClose: () => void;
  onSaved: () => void;
  showToast: (m: string, v: 'success' | 'error' | 'info') => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(category?.image_url ?? null);
  const [parentId, setParentId] = useState<string | null>(category?.parent_id ?? null);
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const parentOptions = categories.filter((c) => !c.parent_id && c.id !== category?.id);

  const handlePickImage = async () => {
    setUploading(true);
    try {
      const asset = await pickProductImage();
      if (!asset) return;
      const url = await uploadProductImage(asset);
      setImageUrl(url);
    } catch (e) {
      showToast(e instanceof ImageUploadError ? e.message : 'Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return showToast('Category name is required.', 'error');
    setSaving(true);
    const input: AdminCategoryInput = {
      name: name.trim(),
      slug: category?.slug ?? slugify(name),
      description: description.trim() || null,
      image_url: imageUrl,
      parent_id: parentId,
      sort_order: parseInt(sortOrder, 10) || 0,
    };
    try {
      if (category) await adminRepository.updateCategory(category.id, input);
      else await adminRepository.createCategory(input);
      showToast(category ? 'Category updated.' : 'Category created.', 'success');
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't save the category.", 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{category ? 'Edit Category' : 'New Category'}</Text>
              <Pressable onPress={onClose} hitSlop={8}><X size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} /></Pressable>
            </View>

            <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {imageUrl ? (
                <Pressable onPress={handlePickImage} style={styles.modalImageWrap}>
                  <AppImage uri={imageUrl} style={styles.modalImage} contentFit="cover" fallbackIcon={ImagePlus} />
                </Pressable>
              ) : (
                <Pressable style={styles.uploadBox} onPress={handlePickImage} disabled={uploading}>
                  {uploading ? <ActivityIndicator color={colors.primary} /> : <ImagePlus size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />}
                  <Text style={styles.uploadText}>Add image</Text>
                </Pressable>
              )}

              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput style={styles.modalInput} value={name} onChangeText={setName} placeholder="e.g. Almonds" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput style={styles.modalInput} value={description} onChangeText={setDescription} placeholder="Optional" placeholderTextColor={colors.textMuted} />

              <Text style={styles.fieldLabel}>Parent Category</Text>
              <View style={styles.chipWrap}>
                <Pressable style={[styles.chip, parentId === null && styles.chipActive]} onPress={() => setParentId(null)}>
                  <Text style={[styles.chipText, parentId === null && styles.chipTextActive]}>None (top-level)</Text>
                </Pressable>
                {parentOptions.map((p) => (
                  <Pressable key={p.id} style={[styles.chip, parentId === p.id && styles.chipActive]} onPress={() => setParentId(p.id)}>
                    <Text style={[styles.chipText, parentId === p.id && styles.chipTextActive]}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Sort Order</Text>
              <TextInput style={styles.modalInput} value={sortOrder} onChangeText={setSortOrder} keyboardType="numeric" placeholderTextColor={colors.textMuted} />
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.modalSaveText}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  toolbar: { padding: spacing.lg, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  addBtnText: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  listContent: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowChild: { marginLeft: spacing.xl, backgroundColor: colors.surfaceMuted },
  thumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  name: { ...textStyles.bodySmall, color: colors.textPrimary },
  description: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  editBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 460, maxHeight: '86%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...shadows.lg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  modalTitle: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  modalImageWrap: { width: '100%', height: 120, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.md, backgroundColor: colors.surfaceSunken },
  modalImage: { width: '100%', height: '100%' },
  uploadBox: { height: 90, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: spacing.md },
  uploadText: { ...textStyles.caption, color: colors.textSecondary },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
  modalInput: { backgroundColor: colors.surfaceSunken, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 42, ...textStyles.bodySmall, color: colors.textPrimary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...textStyles.caption, color: colors.textSecondary, fontSize: 11 },
  chipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
