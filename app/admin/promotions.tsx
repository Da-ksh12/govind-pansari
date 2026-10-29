import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ImagePlus, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { ChoiceChips, EditField, EditSheet } from '../../components/admin/EditSheet';
import { AppImage } from '../../components/ui/AppImage';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository, type AdminBannerRow, type AdminOfferRow } from '../../services/repositories/adminRepository';
import { pickProductImage, uploadProductImage, ImageUploadError } from '../../services/storage/productImages';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';
import { dateInputAfterDays, describeWindow, formatDateInput, type WindowState } from '../../services/dateInput';
import {
  OFFER_CATEGORIES,
  validateBannerForm,
  validateOfferForm,
  type OfferCategory,
  type PromotionErrors,
  type PromotionTargetType,
} from '../../services/promotionEdit';

type Kind = 'banner' | 'offer';
type Row = AdminBannerRow | AdminOfferRow;

const STATE_TONE: Record<WindowState, { bg: string; fg: string }> = {
  live: { bg: colors.successTint, fg: colors.success },
  scheduled: { bg: colors.infoTint, fg: colors.info },
  ended: { bg: colors.surfaceSunken, fg: colors.textSecondary },
  hidden: { bg: colors.surfaceSunken, fg: colors.textMuted },
};

export default function AdminPromotionsScreen() {
  const [kind, setKind] = useState<Kind>('banner');
  const [banners, setBanners] = useState<AdminBannerRow[]>([]);
  const [offers, setOffers] = useState<AdminOfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: Kind; row: Row | null } | null>(null);
  const canManage = useAdminStore((s) => s.hasPermission('promotions.manage'));
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    adminRepository
      .getPromotions()
      .then((d) => {
        setBanners(d.banners);
        setOffers(d.offers);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load banners and offers."))
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);
  useRefetchOnForeground(load);

  const rows: Row[] = kind === 'banner' ? banners : offers;

  const toggle = async (row: Row, next: boolean) => {
    const patch = (list: Row[]) => list.map((r) => (r.id === row.id ? { ...r, isActive: next } : r));
    if (kind === 'banner') setBanners((p) => patch(p) as AdminBannerRow[]);
    else setOffers((p) => patch(p) as AdminOfferRow[]);
    try {
      await adminRepository.setPromotionActive(kind, row.id, next);
    } catch (e) {
      if (kind === 'banner') setBanners((p) => p.map((r) => (r.id === row.id ? { ...r, isActive: !next } : r)));
      else setOffers((p) => p.map((r) => (r.id === row.id ? { ...r, isActive: !next } : r)));
      showToast(e instanceof Error ? e.message : "Couldn't update it.", 'error');
    }
  };

  const remove = (row: Row) => {
    Alert.alert(`Delete "${row.title}"?`, 'It disappears from the app for good. To keep it for later, switch it off instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminRepository.deletePromotion(kind, row.id);
            showToast('Deleted.', 'success');
            load();
          } catch (e) {
            showToast(e instanceof Error ? e.message : "Couldn't delete it.", 'error');
          }
        },
      },
    ]);
  };

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.tabs}>
        {(['banner', 'offer'] as Kind[]).map((k) => (
          <Pressable key={k} style={[styles.tab, kind === k && styles.tabActive]} onPress={() => setKind(k)} accessibilityRole="button" accessibilityState={{ selected: kind === k }}>
            <Text style={[styles.tabText, kind === k && styles.tabTextActive]}>{k === 'banner' ? `Banners (${banners.length})` : `Offers (${offers.length})`}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.intro}>
        {kind === 'banner' ? 'The big pictures at the top of the home screen. Smaller numbers show first.' : 'The offer cards customers can swipe through on the home screen and the Offers page.'}
      </Text>
      {canManage && (
        <Pressable style={styles.addBtn} onPress={() => setEditing({ kind, row: null })} accessibilityRole="button">
          <Plus size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
          <Text style={styles.addBtnText}>{kind === 'banner' ? 'Add banner' : 'Add offer'}</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <AdminShell title="Banners & Offers" subtitle="What customers see on the home screen">
      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : (
            <EmptyState icon={Megaphone} title={loadError ? "Couldn't load" : kind === 'banner' ? 'No banners yet' : 'No offers yet'} subtitle={loadError ?? 'Add one to show it on the home screen.'} ctaLabel={loadError ? 'Try Again' : undefined} onPressCta={loadError ? load : undefined} />
          )
        }
        renderItem={({ item }) => {
          const win = describeWindow(item.startAt, item.endAt, item.isActive, Date.now());
          const tone = STATE_TONE[win.state];
          const opens =
            item.targetType === 'category' ? `Opens category: ${item.targetName ?? '—'}`
            : item.targetType === 'product' ? `Opens product: ${item.targetName ?? '—'}`
            : item.targetType === 'url' ? `Opens: ${(item as AdminBannerRow).targetUrl ?? ''}`
            : 'Opens nothing';
          return (
            <View style={styles.row}>
              <AppImage uri={item.imageUrl} style={styles.thumb} contentFit="cover" fallbackIcon={ImagePlus} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                {!!item.subtitle && <Text style={styles.rowMeta} numberOfLines={1}>{item.subtitle}</Text>}
                <Text style={styles.rowMeta} numberOfLines={1}>{opens}</Text>
                <View style={[styles.chip, { backgroundColor: tone.bg }]}><Text style={[styles.chipText, { color: tone.fg }]}>{win.label}</Text></View>
              </View>
              {canManage && (
                <View style={styles.rowActions}>
                  <Switch value={item.isActive} onValueChange={(v) => toggle(item, v)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
                  <View style={styles.iconRow}>
                    <Pressable style={styles.iconBtn} onPress={() => setEditing({ kind, row: item })} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`}>
                      <Pencil size={ICON_SIZE.xs} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                    </Pressable>
                    <Pressable style={styles.iconBtn} onPress={() => remove(item)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Delete ${item.title}`}>
                      <Trash2 size={ICON_SIZE.xs} color={colors.error} strokeWidth={ICON_STROKE} />
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          );
        }}
      />

      {editing && (
        <PromotionEditor
          kind={editing.kind}
          row={editing.row}
          nextOrder={Math.max(0, ...rows.map((r) => r.sortOrder)) + 1}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </AdminShell>
  );
}

interface EditorProps {
  kind: Kind;
  row: Row | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}

function PromotionEditor({ kind, row, nextOrder, onClose, onSaved }: EditorProps) {
  const showToast = useUIStore((s) => s.showToast);
  const banner = kind === 'banner' ? (row as AdminBannerRow | null) : null;
  const offer = kind === 'offer' ? (row as AdminOfferRow | null) : null;

  const [title, setTitle] = useState(row?.title ?? '');
  const [subtitle, setSubtitle] = useState(row?.subtitle ?? '');
  const [eyebrow, setEyebrow] = useState(banner?.eyebrow ?? '');
  const [imageUrl, setImageUrl] = useState(row?.imageUrl ?? '');
  const [ctaLabel, setCtaLabel] = useState(row?.ctaLabel ?? '');
  const [theme, setTheme] = useState<'dark' | 'light'>(banner?.theme ?? 'dark');
  const [category, setCategory] = useState<OfferCategory | null>(offer?.category ?? null);
  const [targetType, setTargetType] = useState<PromotionTargetType>(row ? (row.targetType === 'collection' ? 'none' : row.targetType) : 'none');
  const [targetId, setTargetId] = useState<string | null>(row?.targetId ?? null);
  const [targetUrl, setTargetUrl] = useState(banner?.targetUrl ?? '');
  const [startDate, setStartDate] = useState(row ? formatDateInput(row.startAt) : formatDateInput(new Date().toISOString()));
  const [endDate, setEndDate] = useState(row ? formatDateInput(row.endAt) : '');
  const [sortOrder, setSortOrder] = useState(String(row?.sortOrder ?? nextOrder));
  const [errors, setErrors] = useState<PromotionErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productHits, setProductHits] = useState<{ id: string; name: string }[]>([]);
  const [pickedName, setPickedName] = useState<string | null>(row?.targetName ?? null);

  useEffect(() => {
    adminRepository.getCategories().then((rows) => setCategories(rows.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })))).catch(() => {});
  }, []);

  // Product search: a short pause after typing, then the top few matches.
  useEffect(() => {
    if (targetType !== 'product' || productQuery.trim().length < 2) {
      setProductHits([]);
      return;
    }
    const timer = setTimeout(() => {
      adminRepository
        .getProducts({ search: productQuery.trim(), limit: 6 })
        .then((rows) => setProductHits((rows as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name }))))
        .catch(() => setProductHits([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [productQuery, targetType]);

  const chooseImage = async () => {
    setUploading(true);
    try {
      const asset = await pickProductImage();
      if (!asset) return;
      setImageUrl(await uploadProductImage(asset));
      setErrors((e) => ({ ...e, imageUrl: undefined }));
    } catch (e) {
      showToast(e instanceof ImageUploadError || e instanceof Error ? e.message : 'Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const common = { title, subtitle, imageUrl, ctaLabel, targetType, targetId, startDate, endDate, sortOrder, isActive: row?.isActive ?? true };
    setFormError(null);
    try {
      if (kind === 'banner') {
        const { errors: found, value } = validateBannerForm({ ...common, eyebrow, theme, targetUrl });
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        setSaving(true);
        await adminRepository.saveBanner(row?.id ?? null, value);
      } else {
        const { errors: found, value } = validateOfferForm({ ...common, category });
        setErrors(found);
        if (Object.keys(found).length > 0 || !value.category) return;
        setSaving(true);
        await adminRepository.saveOffer(row?.id ?? null, { ...value, category: value.category });
      }
      showToast(row ? 'Saved.' : kind === 'banner' ? 'Banner added.' : 'Offer added.', 'success');
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const targetOptions: { value: PromotionTargetType; label: string }[] = [
    { value: 'none', label: 'Nothing' },
    { value: 'category', label: 'A category' },
    { value: 'product', label: 'A product' },
    ...(kind === 'banner' ? [{ value: 'url' as const, label: 'A page in the app' }] : []),
  ];

  return (
    <EditSheet title={`${row ? 'Edit' : 'New'} ${kind}`} onClose={onClose} onSave={save} saving={saving || uploading} error={formError}>
      <Pressable style={styles.picture} onPress={chooseImage} disabled={uploading} accessibilityRole="button" accessibilityLabel="Choose a picture">
        {uploading ? (
          <ActivityIndicator color={colors.primary} />
        ) : imageUrl ? (
          <AppImage uri={imageUrl} style={styles.pictureImg} contentFit="cover" fallbackIcon={ImagePlus} />
        ) : (
          <>
            <ImagePlus size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.pictureText}>Add picture</Text>
          </>
        )}
      </Pressable>
      {!!errors.imageUrl && <Text style={styles.error}>{errors.imageUrl}</Text>}

      <EditField label="Title" value={title} onChangeText={setTitle} error={errors.title} maxLength={80} />
      <EditField label="Subtitle (optional)" value={subtitle} onChangeText={setSubtitle} error={errors.subtitle} maxLength={140} />
      {kind === 'banner' && <EditField label="Small heading above the title (optional)" value={eyebrow} onChangeText={setEyebrow} error={errors.eyebrow} maxLength={24} autoCapitalize="characters" placeholder="PREMIUM" />}
      <EditField label="Button text" value={ctaLabel} onChangeText={setCtaLabel} error={errors.ctaLabel} maxLength={24} placeholder="Shop now" />

      {kind === 'banner' ? (
        <ChoiceChips label="Look" options={[{ value: 'dark', label: 'Dark picture' }, { value: 'light', label: 'Light picture' }]} value={theme} onChange={setTheme} />
      ) : (
        <ChoiceChips label="Kind of offer" options={OFFER_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} value={category} onChange={setCategory} error={errors.category} />
      )}

      <ChoiceChips
        label="When tapped, it opens"
        options={targetOptions}
        value={targetType}
        onChange={(t) => {
          setTargetType(t);
          setTargetId(null);
          setPickedName(null);
        }}
        error={errors.target}
      />
      {targetType === 'category' && (
        <ChoiceChips label="Category" options={categories.map((c) => ({ value: c.id, label: c.name }))} value={targetId} onChange={(id) => setTargetId(id)} />
      )}
      {targetType === 'product' && (
        <View>
          {!!targetId && !!pickedName && <Text style={styles.picked}>Chosen: {pickedName}</Text>}
          <EditField label="Search for the product" value={productQuery} onChangeText={setProductQuery} placeholder="e.g. almonds" autoCapitalize="none" />
          {productHits.map((p) => (
            <Pressable key={p.id} style={styles.hit} onPress={() => { setTargetId(p.id); setPickedName(p.name); setProductQuery(''); setProductHits([]); }} accessibilityRole="button">
              <Text style={styles.hitText}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {targetType === 'url' && (
        <EditField label="Page in the app" value={targetUrl} onChangeText={setTargetUrl} error={errors.targetUrl} autoCapitalize="none" autoCorrect={false} placeholder="/build-your-box" hint="Starts with /, for example /category/almonds." />
      )}

      <EditField label="Shows from (date)" value={startDate} onChangeText={setStartDate} error={errors.startDate} placeholder="25-12-2026" keyboardType="numbers-and-punctuation" hint="India time. Starts at the beginning of that day." />
      <EditField label="Shows until (date)" value={endDate} onChangeText={setEndDate} error={errors.endDate} placeholder="No end date" keyboardType="numbers-and-punctuation" hint="Stays up through the end of that day. Empty = no end." />
      <View style={styles.quickRow}>
        {[7, 30, 90].map((d) => (
          <Pressable key={d} style={styles.quick} onPress={() => setEndDate(dateInputAfterDays(Date.now(), d))} accessibilityRole="button">
            <Text style={styles.quickText}>+{d} days</Text>
          </Pressable>
        ))}
        <Pressable style={styles.quick} onPress={() => setEndDate('')} accessibilityRole="button"><Text style={styles.quickText}>No end</Text></Pressable>
      </View>

      <EditField label="Order on the screen" value={sortOrder} onChangeText={setSortOrder} error={errors.sortOrder} keyboardType="number-pad" maxLength={4} hint="Smaller numbers show first." />
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, gap: spacing.sm, maxWidth: 900, width: '100%', alignSelf: 'center' },
  headerWrap: { gap: spacing.sm, marginBottom: spacing.xs },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: colors.surfaceSunken, borderRadius: radius.pill, padding: 3, alignSelf: 'flex-start' },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  tabTextActive: { color: colors.white },
  intro: { ...textStyles.caption, color: colors.textSecondary, lineHeight: 17 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  addBtnText: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  thumb: { width: 72, height: 54, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  rowTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  rowMeta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, marginTop: 4 },
  chipText: { ...textStyles.caption, fontSize: 11, fontFamily: 'PlusJakartaSans_700Bold' },
  rowActions: { alignItems: 'flex-end', gap: spacing.xs },
  iconRow: { flexDirection: 'row', gap: spacing.xs },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  picture: { height: 120, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden', marginBottom: spacing.xs },
  pictureImg: { width: '100%', height: '100%' },
  pictureText: { ...textStyles.caption, color: colors.textSecondary },
  error: { ...textStyles.caption, color: colors.error, marginBottom: spacing.xs },
  picked: { ...textStyles.caption, color: colors.success, fontFamily: 'PlusJakartaSans_700Bold', marginTop: spacing.sm },
  hit: { paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, marginTop: 4 },
  hitText: { ...textStyles.bodySmall, color: colors.textPrimary },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  quick: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.primaryTint },
  quickText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
});
