import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { AlertTriangle, Check, ImagePlus, Plus, Trash2, X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { formatINR } from '../ui/PriceBlock';
import { GPConfirmModal } from '../ui/modals/GPModal';
import {
  adminRepository,
  type AdminInventoryInput,
  type AdminProductDetail,
  type AdminVariantInput,
} from '../../services/repositories/adminRepository';
import { pickProductImage, uploadProductImage, deleteProductImage, ImageUploadError } from '../../services/storage/productImages';
import { useUIStore } from '../../store/uiStore';

const STEPS = ['Basic Info', 'Images', 'Variants & Pricing', 'Store Inventory', 'Review & Publish'] as const;

interface CategoryOption { id: string; name: string; parent_id: string | null }
interface StoreOption { id: string; name: string; is_active: boolean }

interface DraftVariant extends AdminVariantInput {
  /** Existing variant id when editing, undefined for a not-yet-saved new one. */
  id?: string;
  is_active?: boolean;
}

interface InventoryCell {
  storeId: string;
  quantity: string;
  reorderLevel: string;
  isAvailable: boolean;
}

interface ProductWizardProps {
  mode: 'create' | 'edit';
  productId?: string;
  initial?: AdminProductDetail;
}

/**
 * Guided 5-step Admin product create/edit flow (pre-production
 * hardening, part 2/22) — the only way to add a real product to the
 * catalogue before this was a hand-written SQL seed insert. Create
 * mode defers every write to one transactional RPC at Publish (part
 * 28: no half-created product on failure); edit mode saves each
 * section immediately since the product already exists and each
 * change is independently meaningful.
 */
export function ProductWizard({ mode, productId, initial }: ProductWizardProps) {
  const [step, setStep] = useState(0);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const showToast = useUIStore((s) => s.showToast);

  // Basic info
  const [name, setName] = useState(initial?.name ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.category_id ?? null);
  const [brand, setBrand] = useState(initial?.brand ?? 'Govind Pansari');
  const [shortDescription, setShortDescription] = useState(initial?.short_description ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '));
  const [isFeatured, setIsFeatured] = useState(initial?.is_featured ?? false);
  const [isBestseller, setIsBestseller] = useState(initial?.is_bestseller ?? false);
  const [savingBasic, setSavingBasic] = useState(false);

  // Images
  const [image, setImage] = useState<string | null>(initial?.image ?? null);
  const [gallery, setGallery] = useState<string[]>(initial?.gallery ?? []);
  const [uploading, setUploading] = useState(false);

  // Variants
  const [variants, setVariants] = useState<DraftVariant[]>(
    initial?.product_variants?.map((v) => ({
      id: v.id, sku: v.sku, weight_value: v.weight_value, weight_unit: v.weight_unit as 'g' | 'kg',
      price: v.price, mrp: v.mrp, is_active: v.is_active,
    })) ?? [],
  );
  const [savingVariantIndex, setSavingVariantIndex] = useState<number | null>(null);

  // Inventory — keyed by variant index (create) or variant id (edit)
  const [inventory, setInventory] = useState<Record<string, InventoryCell[]>>({});
  const [savingInventoryKey, setSavingInventoryKey] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  // Real bug found live (a newly-published product had zero inventory
  // rows at every store, so no store could ever fulfill it — checkout
  // correctly, but confusingly, reported "no nearby store can fulfill
  // your cart" with no obvious link back to "you never set stock").
  // Gate publishing on an explicit confirmation when every store's
  // opening-stock field was left at 0, rather than silently shipping
  // an unorderable product.
  const [confirmNoStock, setConfirmNoStock] = useState(false);

  useEffect(() => {
    adminRepository.getCategories().then((c) => setCategories(c as CategoryOption[])).catch(() => {});
    adminRepository.getStores().then((s) => setStores((s as StoreOption[]).filter((x) => x.is_active))).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== 'edit' || !productId || variants.length === 0) return;
    const ids = variants.filter((v) => v.id).map((v) => v.id!);
    adminRepository.getInventoryForVariants(ids).then((rows) => {
      const byVariant: Record<string, InventoryCell[]> = {};
      for (const v of variants) {
        if (!v.id) continue;
        byVariant[v.id] = stores.map((store) => {
          const row = rows.find((r) => r.store_id === store.id && r.product_variant_id === v.id);
          return {
            storeId: store.id,
            quantity: String(row?.quantity ?? 0),
            reorderLevel: String(row?.reorder_level ?? 5),
            isAvailable: row?.is_available ?? true,
          };
        });
      }
      setInventory(byVariant);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, productId, stores.length]);

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const inventoryKeyFor = (idx: number) => (mode === 'edit' ? variants[idx].id! : `new-${idx}`);
  const ensureInventoryRow = (idx: number) => {
    const key = inventoryKeyFor(idx);
    if (inventory[key]) return;
    setInventory((prev) => ({
      ...prev,
      [key]: stores.map((s) => ({ storeId: s.id, quantity: '0', reorderLevel: '5', isAvailable: true })),
    }));
  };

  const goNext = async () => {
    if (step === 0) {
      if (!name.trim()) return showToast('Product name is required.', 'error');
      if (mode === 'edit' && productId) {
        setSavingBasic(true);
        try {
          await adminRepository.updateProduct(productId, buildProductInput());
          showToast('Basic info saved.', 'success');
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Could not save basic info.', 'error');
          setSavingBasic(false);
          return;
        }
        setSavingBasic(false);
      }
    }
    if (step === 2) {
      variants.forEach((_, i) => ensureInventoryRow(i));
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const buildProductInput = () => ({
    name: name.trim(),
    slug: initial?.slug ?? slugify(name),
    category_id: categoryId,
    description: description.trim() || null,
    short_description: shortDescription.trim() || null,
    brand: brand.trim() || 'Govind Pansari',
    image,
    gallery,
    tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
    is_featured: isFeatured,
    is_bestseller: isBestseller,
  });

  // Every other step (Variants, Inventory) saves each change immediately
  // via its own explicit action. Images had no equivalent — a picked
  // image only reached the database as a side effect of clicking "Next"
  // off Step 0, so uploading on the Images step and navigating away any
  // other way (the step dots are freely clickable in edit mode) left a
  // real image uploaded to storage that the database never learned
  // about. Every image mutation now persists immediately in edit mode,
  // matching Variants/Inventory's own pattern — never relying on a
  // later, unrelated step to carry it along.
  const persistImages = async (nextImage: string | null, nextGallery: string[]) => {
    if (mode !== 'edit' || !productId) return;
    try {
      await adminRepository.updateProduct(productId, { ...buildProductInput(), image: nextImage, gallery: nextGallery });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Image uploaded, but saving it to the product failed — please try again.', 'error');
    }
  };

  const handlePickImage = async (target: 'primary' | 'gallery') => {
    setUploading(true);
    try {
      const asset = await pickProductImage();
      if (!asset) return;
      const url = await uploadProductImage(asset);
      if (target === 'primary') {
        setImage(url);
        await persistImages(url, gallery);
      } else {
        const nextGallery = [...gallery, url];
        setGallery(nextGallery);
        await persistImages(image, nextGallery);
      }
      showToast('Image saved.', 'success');
    } catch (e) {
      showToast(e instanceof ImageUploadError ? e.message : 'Upload failed. Please try again.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeGalleryImage = (url: string) => {
    const nextGallery = gallery.filter((g) => g !== url);
    setGallery(nextGallery);
    deleteProductImage(url);
    persistImages(image, nextGallery);
  };
  const removePrimaryImage = () => {
    if (image) deleteProductImage(image);
    setImage(null);
    persistImages(null, gallery);
  };

  const addVariant = () => setVariants((prev) => [...prev, { sku: '', weight_value: 0, weight_unit: 'g', price: 0, mrp: 0 }]);
  const updateVariant = (i: number, patch: Partial<DraftVariant>) =>
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const removeVariant = (i: number) => setVariants((prev) => prev.filter((_, idx) => idx !== i));

  const saveVariant = async (i: number) => {
    const v = variants[i];
    if (!v.sku.trim() || v.weight_value <= 0 || v.price < 0 || v.mrp < v.price) {
      return showToast('Check SKU, weight, price and MRP (MRP must be ≥ price).', 'error');
    }
    if (mode !== 'edit' || !productId) return; // create mode: variants save at Publish
    setSavingVariantIndex(i);
    try {
      const result = await adminRepository.upsertVariant(v.id ?? null, productId, v);
      updateVariant(i, { id: result.variantId });
      showToast('Variant saved.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save variant.', 'error');
    } finally {
      setSavingVariantIndex(null);
    }
  };

  const archiveVariant = async (i: number) => {
    const v = variants[i];
    if (!v.id) return removeVariant(i); // never saved — just drop it locally
    try {
      await adminRepository.setVariantActive(v.id, false);
      updateVariant(i, { is_active: false });
      showToast('Variant archived.', 'success');
    } catch {
      showToast('Could not archive variant.', 'error');
    }
  };

  const updateInventoryCell = (key: string, storeId: string, patch: Partial<InventoryCell>) => {
    setInventory((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).map((c) => (c.storeId === storeId ? { ...c, ...patch } : c)),
    }));
  };

  const saveInventoryCell = async (variantId: string, cell: InventoryCell) => {
    const qty = parseInt(cell.quantity, 10);
    if (Number.isNaN(qty) || qty < 0) return showToast('Enter a valid quantity.', 'error');
    const key = `${variantId}-${cell.storeId}`;
    setSavingInventoryKey(key);
    try {
      await adminRepository.initializeInventory(cell.storeId, variantId, qty, parseInt(cell.reorderLevel, 10) || 5, cell.isAvailable);
      showToast('Inventory saved.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save inventory.', 'error');
    } finally {
      setSavingInventoryKey(null);
    }
  };

  const buildInventoryInput = (): AdminInventoryInput[] => {
    const inventoryInput: AdminInventoryInput[] = [];
    variants.forEach((_, idx) => {
      const cells = inventory[inventoryKeyFor(idx)] ?? [];
      for (const cell of cells) {
        const qty = parseInt(cell.quantity, 10);
        if (!Number.isNaN(qty) && qty > 0) {
          inventoryInput.push({
            variant_index: idx, store_id: cell.storeId, quantity: qty,
            reorder_level: parseInt(cell.reorderLevel, 10) || 5, is_available: cell.isAvailable,
          });
        }
      }
    });
    return inventoryInput;
  };

  const publish = async (force = false) => {
    if (variants.length === 0) return showToast('Add at least one variant before publishing.', 'error');
    for (const v of variants) {
      if (!v.sku.trim() || v.weight_value <= 0 || v.price < 0 || v.mrp < v.price) {
        return showToast('Every variant needs a valid SKU, weight, price and MRP.', 'error');
      }
    }
    const inventoryInput = buildInventoryInput();
    if (inventoryInput.length === 0 && !force) {
      setConfirmNoStock(true);
      return;
    }
    setConfirmNoStock(false);
    setPublishing(true);
    try {
      const result = await adminRepository.createProduct(buildProductInput(), variants, inventoryInput);
      showToast('Product published.', 'success');
      router.replace(`/admin/products/${result.productId}` as never);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not publish the product.', 'error');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.stepper}>
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <View style={[styles.stepLine, i <= step && styles.stepLineDone]} />}
            <Pressable style={styles.stepDotWrap} onPress={() => setStep(i)} disabled={i > step && mode === 'create'}>
              <View style={[styles.stepDot, i === step && styles.stepDotActive, i < step && styles.stepDotDone]}>
                {i < step ? <Check size={12} color={colors.white} strokeWidth={ICON_STROKE} /> : <Text style={[styles.stepDotText, i === step && styles.stepDotTextActive]}>{i + 1}</Text>}
              </View>
              <Text style={[styles.stepLabel, i === step && styles.stepLabelActive]} numberOfLines={1}>{label}</Text>
            </Pressable>
          </React.Fragment>
        ))}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {step === 0 && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Basic Information</Text>
            <Text style={styles.stepSubtitle}>Tell customers what this product is</Text>
            <Field label="Product Name *">
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. California Almonds" placeholderTextColor={colors.textMuted} />
            </Field>
            <Field label="Short Description">
              <TextInput style={styles.input} value={shortDescription} onChangeText={setShortDescription} placeholder="One line shown on product cards" placeholderTextColor={colors.textMuted} />
            </Field>
            <Field label="Full Description">
              <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} multiline placeholder="Full product description" placeholderTextColor={colors.textMuted} />
            </Field>
            <Field label="Category">
              <View style={styles.chipWrap}>
                {categories.map((c) => (
                  <Pressable key={c.id} style={[styles.chip, categoryId === c.id && styles.chipActive]} onPress={() => setCategoryId(c.id)}>
                    <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.parent_id ? `↳ ${c.name}` : c.name}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            <Field label="Brand">
              <TextInput style={styles.input} value={brand} onChangeText={setBrand} placeholderTextColor={colors.textMuted} />
            </Field>
            <Field label="Tags (comma separated)">
              <TextInput style={styles.input} value={tagsText} onChangeText={setTagsText} placeholder="premium, healthy-snacking" placeholderTextColor={colors.textMuted} />
            </Field>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Featured (Premium Collection)</Text>
              <Switch value={isFeatured} onValueChange={setIsFeatured} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Bestseller (Most Loved)</Text>
              <Switch value={isBestseller} onValueChange={setIsBestseller} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
            </View>
          </View>
        )}

        {step === 1 && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Product Images</Text>
            <Text style={styles.stepSubtitle}>Add a primary photo and any supporting gallery shots</Text>
            <Field label="Primary Image">
              {image ? (
                <View style={styles.imagePreviewWrap}>
                  <Image source={{ uri: image }} style={styles.imagePreview} contentFit="cover" />
                  <Pressable style={styles.imageRemoveBtn} onPress={removePrimaryImage} hitSlop={8}>
                    <X size={14} color={colors.white} strokeWidth={ICON_STROKE} />
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.uploadBox} onPress={() => handlePickImage('primary')} disabled={uploading}>
                  {uploading ? <ActivityIndicator color={colors.primary} /> : <ImagePlus size={ICON_SIZE.lg} color={colors.primary} strokeWidth={ICON_STROKE} />}
                  <Text style={styles.uploadText}>Upload primary image</Text>
                </Pressable>
              )}
            </Field>
            <Field label="Gallery">
              <View style={styles.galleryRow}>
                {gallery.map((url) => (
                  <View key={url} style={styles.galleryThumbWrap}>
                    <Image source={{ uri: url }} style={styles.galleryThumb} contentFit="cover" />
                    <Pressable style={styles.imageRemoveBtn} onPress={() => removeGalleryImage(url)} hitSlop={8}>
                      <X size={12} color={colors.white} strokeWidth={ICON_STROKE} />
                    </Pressable>
                  </View>
                ))}
                <Pressable style={styles.addGalleryBtn} onPress={() => handlePickImage('gallery')} disabled={uploading}>
                  <Plus size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
                </Pressable>
              </View>
            </Field>
          </View>
        )}

        {step === 2 && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Variants &amp; Pricing</Text>
            <Text style={styles.stepSubtitle}>Each weight or pack size is sold as its own variant</Text>
            {variants.map((v, i) => (
              <View key={v.id ?? i} style={[styles.variantCard, v.is_active === false && styles.variantCardArchived]}>
                <Text style={styles.variantCardLabel}>Variant {i + 1}</Text>
                <View style={styles.variantRow}>
                  <Field label="SKU" style={{ flex: 1.2 }}>
                    <TextInput style={styles.inputSmall} value={v.sku} onChangeText={(t) => updateVariant(i, { sku: t.toUpperCase() })} placeholder="SKU" placeholderTextColor={colors.textMuted} />
                  </Field>
                  <Field label="Weight" style={{ flex: 0.8 }}>
                    <TextInput style={styles.inputSmall} value={v.weight_value ? String(v.weight_value) : ''} onChangeText={(t) => updateVariant(i, { weight_value: parseFloat(t) || 0 })} keyboardType="numeric" placeholder="500" placeholderTextColor={colors.textMuted} />
                  </Field>
                  <Field label="Unit" style={{ flex: 0.6 }}>
                    <View style={styles.unitToggle}>
                      {(['g', 'kg'] as const).map((u) => (
                        <Pressable key={u} style={[styles.unitBtn, v.weight_unit === u && styles.unitBtnActive]} onPress={() => updateVariant(i, { weight_unit: u })}>
                          <Text style={[styles.unitBtnText, v.weight_unit === u && styles.unitBtnTextActive]}>{u}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </Field>
                </View>
                <View style={styles.variantRow}>
                  <Field label="Price (₹)" style={{ flex: 1 }}>
                    <TextInput style={styles.inputSmall} value={v.price ? String(v.price) : ''} onChangeText={(t) => updateVariant(i, { price: parseFloat(t) || 0 })} keyboardType="numeric" placeholder="450" placeholderTextColor={colors.textMuted} />
                  </Field>
                  <Field label="MRP (₹)" style={{ flex: 1 }}>
                    <TextInput style={styles.inputSmall} value={v.mrp ? String(v.mrp) : ''} onChangeText={(t) => updateVariant(i, { mrp: parseFloat(t) || 0 })} keyboardType="numeric" placeholder="550" placeholderTextColor={colors.textMuted} />
                  </Field>
                  <View style={styles.variantActions}>
                    {mode === 'edit' && (
                      <Pressable style={styles.variantActionBtn} onPress={() => saveVariant(i)} disabled={savingVariantIndex === i}>
                        {savingVariantIndex === i ? <ActivityIndicator size="small" color={colors.primary} /> : <Check size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} />}
                      </Pressable>
                    )}
                    <Pressable style={styles.variantActionBtn} onPress={() => (mode === 'edit' ? archiveVariant(i) : removeVariant(i))}>
                      <Trash2 size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
            <Pressable style={styles.addVariantBtn} onPress={addVariant}>
              <Plus size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.addVariantText}>Add Variant</Text>
            </Pressable>
          </View>
        )}

        {step === 3 && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Store Inventory</Text>
            <Text style={styles.stepSubtitle}>Set opening stock for each store and variant</Text>
            {variants.length === 0 && <Text style={styles.emptyHint}>Add variants in the previous step first.</Text>}
            {variants.map((v, idx) => {
              const key = inventoryKeyFor(idx);
              const cells = inventory[key] ?? [];
              return (
                <View key={key} style={styles.inventoryCard}>
                  <Text style={styles.inventoryVariantTitle}>{v.sku || `Variant ${idx + 1}`} — {v.weight_value}{v.weight_unit}</Text>
                  {cells.map((cell) => {
                    const store = stores.find((s) => s.id === cell.storeId);
                    const savingKey = v.id ? `${v.id}-${cell.storeId}` : null;
                    return (
                      <View key={cell.storeId} style={styles.inventoryStoreRow}>
                        <Text style={styles.inventoryStoreName} numberOfLines={1}>{store?.name ?? cell.storeId}</Text>
                        <TextInput style={styles.inventoryQtyInput} value={cell.quantity} onChangeText={(t) => updateInventoryCell(key, cell.storeId, { quantity: t })} keyboardType="numeric" placeholder="Qty" placeholderTextColor={colors.textMuted} />
                        <TextInput style={styles.inventoryQtyInput} value={cell.reorderLevel} onChangeText={(t) => updateInventoryCell(key, cell.storeId, { reorderLevel: t })} keyboardType="numeric" placeholder="Reorder" placeholderTextColor={colors.textMuted} />
                        <Switch value={cell.isAvailable} onValueChange={(val) => updateInventoryCell(key, cell.storeId, { isAvailable: val })} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
                        {mode === 'edit' && v.id && (
                          <Pressable style={styles.variantActionBtn} onPress={() => saveInventoryCell(v.id!, cell)} disabled={savingInventoryKey === savingKey}>
                            {savingInventoryKey === savingKey ? <ActivityIndicator size="small" color={colors.primary} /> : <Check size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} />}
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </View>
        )}

        {step === 4 && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Review &amp; Publish</Text>
            <Text style={styles.stepSubtitle}>Double-check everything before it goes live</Text>
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>{name || 'Untitled product'}</Text>
              <Text style={styles.reviewMeta}>{categories.find((c) => c.id === categoryId)?.name ?? 'No category'} • {brand}</Text>
              <Text style={styles.reviewMeta}>{variants.length} variant{variants.length === 1 ? '' : 's'}</Text>
              {variants.map((v, i) => (
                <Text key={i} style={styles.reviewVariantLine}>• {v.sku} — {v.weight_value}{v.weight_unit} — {formatINR(v.price)} (MRP {formatINR(v.mrp)})</Text>
              ))}
            </View>
            {mode === 'create' && buildInventoryInput().length === 0 && (
              <View style={styles.noStockWarning}>
                <AlertTriangle size={ICON_SIZE.sm} color={colors.warning} strokeWidth={ICON_STROKE} />
                <Text style={styles.noStockWarningText}>
                  No opening stock set at any store — go back to Store Inventory to add some, or customers won't be able to order this product until you do.
                </Text>
              </View>
            )}
            {mode === 'create' ? (
              <Pressable style={styles.publishBtn} onPress={() => publish()} disabled={publishing}>
                {publishing ? <ActivityIndicator color={colors.white} /> : <Text style={styles.publishBtnText}>Publish Product</Text>}
              </Pressable>
            ) : (
              <Text style={styles.emptyHint}>Every section above already saves as you edit it.</Text>
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.footerBtn} onPress={() => setStep((s) => Math.max(s - 1, 0))} disabled={step === 0}>
          <Text style={[styles.footerBtnText, step === 0 && styles.footerBtnTextDisabled]}>Back</Text>
        </Pressable>
        {step < STEPS.length - 1 && (
          <Pressable style={styles.footerBtnPrimary} onPress={goNext} disabled={savingBasic}>
            {savingBasic ? <ActivityIndicator color={colors.white} /> : <Text style={styles.footerBtnPrimaryText}>Next</Text>}
          </Pressable>
        )}
      </View>

      <GPConfirmModal
        visible={confirmNoStock}
        onClose={() => setConfirmNoStock(false)}
        title="Publish with no stock?"
        message="This product has no opening stock at any store. It will go live, but no customer will be able to order it until you add stock from Inventory. Publish anyway?"
        primaryLabel="Publish Anyway"
        onPressPrimary={() => publish(true)}
        secondaryLabel="Go Back"
        onPressSecondary={() => setConfirmNoStock(false)}
      />
    </KeyboardAvoidingView>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  stepDotWrap: { alignItems: 'center', gap: 4, width: 84 },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: colors.primary },
  stepDotDone: { backgroundColor: colors.success },
  stepDotText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_700Bold' },
  stepDotTextActive: { color: colors.white },
  stepLabel: { ...textStyles.caption, fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  stepLabelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.border, marginTop: 13, marginHorizontal: -8 },
  stepLineDone: { backgroundColor: colors.success },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxl, maxWidth: 720, width: '100%', alignSelf: 'center' },
  section: { gap: spacing.md },
  stepTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19, color: colors.textPrimary, marginTop: -4 },
  stepSubtitle: { ...textStyles.bodySmall, color: colors.textSecondary, marginTop: -8, marginBottom: 4 },
  field: { gap: 6 },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, height: 46, ...textStyles.bodySmall, color: colors.textPrimary },
  inputSmall: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, height: 42, ...textStyles.caption, color: colors.textPrimary },
  textArea: { height: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...textStyles.caption, color: colors.textSecondary },
  chipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, ...shadows.xs },
  switchLabel: { ...textStyles.bodySmall, color: colors.textPrimary },
  uploadBox: { height: 160, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.surface },
  uploadText: { ...textStyles.caption, color: colors.textSecondary },
  imagePreviewWrap: { width: '100%', height: 200, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  imagePreview: { width: '100%', height: '100%' },
  imageRemoveBtn: { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(36,21,18,0.72)', alignItems: 'center', justifyContent: 'center' },
  galleryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  galleryThumbWrap: { width: 84, height: 84, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  galleryThumb: { width: '100%', height: '100%' },
  addGalleryBtn: { width: 84, height: 84, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  variantCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  variantCardArchived: { opacity: 0.5 },
  variantCardLabel: { ...textStyles.caption, color: colors.goldDark, fontFamily: 'PlusJakartaSans_700Bold', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10.5 },
  variantRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  unitToggle: { flexDirection: 'row', gap: 4 },
  unitBtn: { flex: 1, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  unitBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  unitBtnText: { ...textStyles.caption, color: colors.textSecondary },
  unitBtnTextActive: { color: colors.white },
  variantActions: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  // 40x40 (not the previous 34x34 + hitSlop): these two buttons sit only
  // 8px apart, so a hitSlop generous enough to reach 40x40's worth of
  // touch area would have made their hit zones overlap and made "Save"
  // vs "Delete" ambiguous right at the boundary — sizing the box itself
  // up is the safe fix here, not hitSlop.
  variantActionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  addVariantBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: radius.md, height: 46 },
  addVariantText: { ...textStyles.button, color: colors.primary, fontSize: 13 },
  inventoryCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  inventoryVariantTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  inventoryStoreRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inventoryStoreName: { flex: 1, ...textStyles.caption, color: colors.textSecondary },
  inventoryQtyInput: { width: 64, height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, textAlign: 'center', ...textStyles.caption, color: colors.textPrimary },
  emptyHint: { ...textStyles.bodySmall, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl },
  reviewCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: 4, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  reviewTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  reviewMeta: { ...textStyles.caption, color: colors.textSecondary },
  reviewVariantLine: { ...textStyles.caption, color: colors.textPrimary, marginTop: 4 },
  noStockWarning: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningTint, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md, alignItems: 'flex-start' },
  noStockWarningText: { ...textStyles.caption, color: colors.warning, flex: 1, lineHeight: 17 },
  publishBtn: { backgroundColor: colors.primary, borderRadius: radius.md, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  publishBtnText: { ...textStyles.button, color: colors.white, fontSize: 15 },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  footerBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  footerBtnText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  footerBtnTextDisabled: { color: colors.textMuted },
  footerBtnPrimary: { flex: 2, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  footerBtnPrimaryText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
