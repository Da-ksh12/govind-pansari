import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { Check, Copy, Info, Plus, Store as StoreIcon, Trash2, Wand2 } from 'lucide-react-native';
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
import { uploadProductImage, deleteProductImage, ImageUploadError } from '../../services/storage/productImages';
import type { EditedImage } from '../../services/storage/imageProcessing';
import { ProductImageField } from './ProductImageField';
import { useUIStore } from '../../store/uiStore';
import { setAdminBackGuard } from '../../services/adminBackGuard';
import {
  nextMrpText,
  normalizeSku,
  parseDecimal,
  parseWholeNumber,
  validateVariants,
  variantErrorsPresent,
  type VariantFieldErrors,
} from '../../services/productValidation';
import {
  buildInventoryInput as buildInventoryRows,
  copyStockToAllStores,
  discountPercent,
  duplicateSizeNotes,
  isRemoteUrl,
  moveItem,
  reviewStockLines,
  suggestSku,
  variantName,
} from '../../services/productWizard';

const STEPS = ['Basic Info', 'Images', 'Variants & Pricing', 'Store Inventory', 'Review & Publish'] as const;
/** Short labels for narrow screens, where five full labels cannot sit side by side without colliding. */
const STEP_SHORT_LABELS = ['Basic', 'Images', 'Variants', 'Stock', 'Review'] as const;
const NARROW_STEPPER_WIDTH = 560;

interface CategoryOption { id: string; name: string; parent_id: string | null }
interface StoreOption { id: string; name: string; is_active: boolean }

interface DraftVariant extends AdminVariantInput {
  /** Existing variant id when editing, undefined for a not-yet-saved new one. */
  id?: string;
  is_active?: boolean;
  /**
   * What the admin actually typed. The numeric fields above are derived from
   * these, so typing "449." or "449.5" is never rewritten under the cursor,
   * and an invalid entry is shown as invalid instead of silently becoming 0.
   */
  weightText: string;
  priceText: string;
  mrpText: string;
  /** True once the admin has typed an MRP (always true for an existing variant), so the price no longer drives it. */
  mrpTouched: boolean;
  /** Stable React key for this draft row — an array index would let rows swap their inputs' state when a middle variant is removed. */
  clientId: string;
}

let draftVariantCounter = 0;
const emptyVariant = (): DraftVariant => ({
  sku: '', weight_value: 0, weight_unit: 'g', price: 0, mrp: 0, weightText: '', priceText: '', mrpText: '', mrpTouched: false,
  clientId: `draft-${++draftVariantCounter}`,
});

/** The fields sent to the server — never the draft-only text helpers. */
function toVariantInput(v: DraftVariant): AdminVariantInput {
  return {
    sku: normalizeSku(v.sku),
    weight_value: parseDecimal(v.weightText) || 0,
    weight_unit: v.weight_unit,
    price: parseDecimal(v.priceText) || 0,
    mrp: parseDecimal(v.mrpText) || 0,
  };
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
  /** Create mode: called once the product is published, just before leaving, so the host can discard this form. */
  onPublished?: () => void;
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
export function ProductWizard({ mode, productId, initial, onPublished }: ProductWizardProps) {
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
  // Create mode keeps photos on the device until Publish: nothing is uploaded (so nothing can be orphaned or doubled) until the
  // product is really being created. `draftBase64` holds a draft's data, `uploadedForDraft` remembers what a draft already
  // became in Storage so a retried Publish never uploads it twice.
  const draftBase64 = useRef(new Map<string, string>());
  const uploadedForDraft = useRef(new Map<string, string>());
  const published = useRef(false);

  // Variants
  const [variants, setVariants] = useState<DraftVariant[]>(
    initial?.product_variants?.map((v) => ({
      id: v.id, sku: v.sku, weight_value: v.weight_value, weight_unit: v.weight_unit as 'g' | 'kg',
      price: v.price, mrp: v.mrp, is_active: v.is_active,
      weightText: String(v.weight_value), priceText: String(v.price), mrpText: String(v.mrp), mrpTouched: true,
      clientId: v.id,
    })) ?? [],
  );
  const [savingVariantIndex, setSavingVariantIndex] = useState<number | null>(null);
  // Errors for empty fields only appear after the admin tries to continue;
  // errors on a field that already has text (a bad number, a duplicate SKU, an
  // MRP below the price) appear straight away.
  const [showVariantErrors, setShowVariantErrors] = useState(false);
  const [takenSkus, setTakenSkus] = useState<string[]>([]);
  const [checkingSkus, setCheckingSkus] = useState(false);
  const [showStockErrors, setShowStockErrors] = useState(false);
  const [showImageError, setShowImageError] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [variantToRemove, setVariantToRemove] = useState<number | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const narrowStepper = windowWidth < NARROW_STEPPER_WIDTH;

  // Inventory — keyed by variant index (create) or variant id (edit)
  const [inventory, setInventory] = useState<Record<string, InventoryCell[]>>({});
  const [savingInventoryKey, setSavingInventoryKey] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);

  useEffect(
    () => () => {
      if (published.current) return;
      for (const url of uploadedForDraft.current.values()) deleteProductImage(url);
    },
    [],
  );

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

  // A new product that has anything entered is "dirty" — leaving the wizard
  // would lose it, so that asks first. Editing an existing product saves each
  // section as it goes, so there is nothing to lose and no prompt.
  const isDirty =
    mode === 'create' &&
    (name.trim() !== '' || shortDescription.trim() !== '' || description.trim() !== '' || tagsText.trim() !== '' || !!image || gallery.length > 0 || variants.length > 0);

  const leaveWizard = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin/products' as never);
  };

  /** Back steps through the wizard; from the first step it leaves to the previous screen. Entered data survives stepping back because every step shares this component's state. */
  const goBack = () => {
    if (step > 0) {
      setStep((s) => s - 1);
      return;
    }
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    leaveWizard();
  };

  /** Back inside the wizard: step back, or ask before discarding. Returns false when nothing needs guarding (the caller may leave). */
  const interceptBack = (): boolean => {
    if (step > 0) {
      setStep((s) => s - 1);
      return true;
    }
    if (isDirty) {
      setConfirmDiscard(true);
      return true;
    }
    return false;
  };

  // Android's hardware back button AND the admin header's Back button follow the same rule instead of dropping the
  // admin out of the wizard mid-way and discarding what they entered.
  useFocusEffect(
    useCallback(() => {
      setAdminBackGuard(interceptBack);
      const subscription = BackHandler.addEventListener('hardwareBackPress', interceptBack);
      return () => {
        setAdminBackGuard(null);
        subscription.remove();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step, isDirty]),
  );

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  // Keyed by the variant's stable id (not its position), so removing or
  // reordering a variant can never attach one variant's stock to another.
  const inventoryKeyFor = (idx: number) => (mode === 'edit' ? variants[idx].id ?? variants[idx].clientId : variants[idx].clientId);
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
      // An existing product that still has no photo can't be saved yet (the photo is mandatory);
      // its basic info is saved together with the photo on the Images step instead.
      if (mode === 'edit' && productId && image) {
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
    if (step === 1 && !image) {
      setShowImageError(true);
      return showToast('Add a primary product photo to continue.', 'error');
    }
    if (step === 2) {
      if (!(await validateVariantsStep())) return;
      variants.forEach((_, i) => ensureInventoryRow(i));
    }
    if (step === 3 && inventoryHasErrors()) {
      setShowStockErrors(true);
      showToast('Fix the highlighted stock fields to continue.', 'error');
      return;
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
  /** Resolves true when the product record now matches the images on screen (or there is no record yet to keep in step). */
  const persistImages = async (nextImage: string | null, nextGallery: string[]): Promise<boolean> => {
    if (mode !== 'edit' || !productId) return true;
    try {
      await adminRepository.updateProduct(productId, { ...buildProductInput(), image: nextImage, gallery: nextGallery });
      return true;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't save the image change to the product — please try again.", 'error');
      return false;
    }
  };

  /**
   * Where a finished (cropped) photo goes. Create mode: kept on the device as a draft until Publish. Edit mode: straight to
   * Storage, because the product already exists and every change is saved as it is made.
   */
  const storeImage = async (edited: EditedImage): Promise<string> => {
    if (mode === 'create') {
      draftBase64.current.set(edited.uri, edited.base64);
      return edited.uri;
    }
    return uploadProductImage(edited);
  };

  /** A photo that is no longer wanted: its draft data goes, and so does any file an earlier Publish attempt already uploaded for it. */
  const discardImage = (uri: string) => {
    if (isRemoteUrl(uri)) {
      deleteProductImage(uri);
      return;
    }
    draftBase64.current.delete(uri);
    const uploaded = uploadedForDraft.current.get(uri);
    if (uploaded) {
      uploadedForDraft.current.delete(uri);
      deleteProductImage(uploaded);
    }
  };

  const reportImageError = (e: unknown) => showToast(e instanceof ImageUploadError ? e.message : 'Could not save the photo. Please try again.', 'error');

  /** Runs one photo change. Any failure is reported once and rethrown so the editor stops its queue instead of carrying on half-done. */
  const runImageChange = async (change: () => Promise<void>) => {
    if (uploading) return;
    setUploading(true);
    try {
      await change();
    } catch (e) {
      reportImageError(e);
      throw e;
    } finally {
      setUploading(false);
    }
  };

  // The stored file is deleted only AFTER the product record has stopped pointing at it. Deleting first (or in parallel)
  // left products referencing files that no longer existed whenever the save failed or was interrupted — the dead image
  // URLs behind several blank product photos.
  const choosePrimary = (edited: EditedImage) =>
    runImageChange(async () => {
      const url = await storeImage(edited);
      const previous = image;
      setImage(url);
      if (await persistImages(url, gallery)) {
        if (previous && previous !== url) discardImage(previous);
        if (mode === 'edit') showToast('Photo saved.', 'success');
      } else {
        setImage(previous);
        discardImage(url);
        throw new Error('The photo could not be saved to the product.');
      }
    });

  const addGalleryImage = (edited: EditedImage) =>
    runImageChange(async () => {
      const url = await storeImage(edited);
      const next = [...gallery, url];
      setGallery(next);
      if (!(await persistImages(image, next))) {
        setGallery(gallery);
        discardImage(url);
        throw new Error('The photo could not be saved to the product.');
      }
    });

  const replaceGalleryImage = (index: number, edited: EditedImage) =>
    runImageChange(async () => {
      const url = await storeImage(edited);
      const old = gallery[index];
      const next = gallery.map((g, i) => (i === index ? url : g));
      setGallery(next);
      if (await persistImages(image, next)) {
        if (old) discardImage(old);
      } else {
        setGallery(gallery);
        discardImage(url);
        throw new Error('The photo could not be saved to the product.');
      }
    });

  const removeGalleryImage = (index: number) =>
    runImageChange(async () => {
      const removed = gallery[index];
      if (!removed) return;
      const next = gallery.filter((_, i) => i !== index);
      setGallery(next);
      if (await persistImages(image, next)) discardImage(removed);
      else {
        setGallery(gallery);
        throw new Error('The photo could not be removed from the product.');
      }
    });

  const moveGalleryImage = (index: number, direction: -1 | 1) =>
    runImageChange(async () => {
      const next = moveItem(gallery, index, index + direction);
      if (next === gallery) return;
      setGallery(next);
      if (!(await persistImages(image, next))) {
        setGallery(gallery);
        throw new Error('The new photo order could not be saved.');
      }
    });

  /** Publish only: a draft becomes a Storage file exactly once (a retried Publish reuses what it already uploaded). */
  const resolveImageForPublish = async (uri: string): Promise<string> => {
    if (isRemoteUrl(uri)) return uri;
    const known = uploadedForDraft.current.get(uri);
    if (known) return known;
    const base64 = draftBase64.current.get(uri);
    if (!base64) throw new ImageUploadError('A photo is no longer available on this device — please add it again.');
    const url = await uploadProductImage({ uri, base64, mimeType: 'image/jpeg' });
    uploadedForDraft.current.set(uri, url);
    return url;
  };

  const addVariant = () => setVariants((prev) => [...prev, emptyVariant()]);
  const updateVariant = (i: number, patch: Partial<DraftVariant>) =>
    setVariants((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  const removeVariant = (i: number) => {
    const key = inventoryKeyFor(i);
    setVariants((prev) => prev.filter((_, idx) => idx !== i));
    // Its stock goes with it, so it can never be picked up by the variant that takes over its position.
    setInventory((prev) => {
      const { [key]: _gone, ...rest } = prev;
      return rest;
    });
    setTakenSkus([]);
  };

  const sizeNotes = useMemo(() => duplicateSizeNotes(variants), [variants]);
  const storeNames = useMemo(() => Object.fromEntries(stores.map((s) => [s.id, s.name])) as Record<string, string>, [stores]);

  /** A copy of this variant (same size, price and stock) with its own suggested SKU, placed right after it. */
  const duplicateVariant = (i: number) => {
    const source = variants[i];
    if (!source) return;
    const copy: DraftVariant = {
      ...emptyVariant(),
      weight_unit: source.weight_unit,
      weight_value: source.weight_value,
      weightText: source.weightText,
      price: source.price,
      priceText: source.priceText,
      mrp: source.mrp,
      mrpText: source.mrpText,
      mrpTouched: source.mrpTouched,
      sku: suggestSku(name, source.weightText, source.weight_unit, variants.map((v) => v.sku)),
    };
    setVariants((prev) => [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)]);
    const sourceStock = inventory[inventoryKeyFor(i)];
    if (sourceStock) setInventory((prev) => ({ ...prev, [copy.clientId]: sourceStock.map((cell) => ({ ...cell })) }));
    setTakenSkus([]);
  };

  const suggestSkuFor = (i: number) => {
    const v = variants[i];
    if (!v) return;
    editVariantField(i, 'sku', suggestSku(name, v.weightText, v.weight_unit, variants.filter((_, idx) => idx !== i).map((x) => x.sku)));
  };

  /** Removing a variant that has anything entered (or an already-saved one) asks first; an untouched blank one just goes. */
  const requestRemoveVariant = (i: number) => {
    const v = variants[i];
    if (!v) return;
    const stock = inventory[inventoryKeyFor(i)] ?? [];
    const hasData = !!(v.sku.trim() || v.weightText.trim() || v.priceText.trim() || v.mrpText.trim() || stock.some((c) => c.quantity.trim() && c.quantity.trim() !== '0'));
    if (!hasData && !(mode === 'edit' && v.id)) removeVariant(i);
    else setVariantToRemove(i);
  };

  const applyToAllStores = (key: string, fromStoreId: string) =>
    setInventory((prev) => ({ ...prev, [key]: copyStockToAllStores(prev[key] ?? [], fromStoreId) }));

  /** Every edit goes through here so the typed text, the derived numbers and the MRP-follows-price rule can never drift apart. */
  const editVariantField = (i: number, field: 'sku' | 'weight' | 'price' | 'mrp', text: string) => {
    setTakenSkus([]);
    setVariants((prev) =>
      prev.map((v, idx) => {
        if (idx !== i) return v;
        if (field === 'sku') return { ...v, sku: text.toUpperCase() };
        if (field === 'weight') return { ...v, weightText: text, weight_value: parseDecimal(text) || 0 };
        if (field === 'price') {
          const mrpText = nextMrpText({ priceText: text, mrpText: v.mrpText, mrpTouched: v.mrpTouched });
          return { ...v, priceText: text, price: parseDecimal(text) || 0, mrpText, mrp: parseDecimal(mrpText) || 0 };
        }
        return { ...v, mrpText: text, mrp: parseDecimal(text) || 0, mrpTouched: true };
      }),
    );
  };

  const variantErrors = useMemo<VariantFieldErrors[]>(() => {
    const errors = validateVariants(variants);
    // A SKU that another product already owns is reported on that field too.
    return errors.map((e, i) => (!e.sku && takenSkus.includes(normalizeSku(variants[i].sku)) ? { ...e, sku: 'This SKU is already used by another variant.' } : e));
  }, [variants, takenSkus]);

  /** The error to show for a field: always for a typed value, and for an empty one only after the admin tried to continue. */
  const visibleError = (i: number, field: keyof VariantFieldErrors): string | undefined => {
    const message = variantErrors[i]?.[field];
    if (!message) return undefined;
    const v = variants[i];
    const typed = field === 'sku' ? v.sku.trim() !== '' : field === 'weight' ? v.weightText.trim() !== '' : field === 'price' ? v.priceText.trim() !== '' : v.mrpText.trim() !== '';
    return showVariantErrors || typed ? message : undefined;
  };

  /** Validates every variant and asks the database about SKU clashes. Returns true when it is safe to continue. */
  const validateVariantsStep = async (): Promise<boolean> => {
    if (variants.length === 0) {
      showToast('Add at least one variant.', 'error');
      return false;
    }
    setShowVariantErrors(true);
    if (variantErrorsPresent(validateVariants(variants))) {
      showToast('Fix the highlighted fields to continue.', 'error');
      return false;
    }
    setCheckingSkus(true);
    try {
      const taken = await adminRepository.findTakenSkus(variants.map((v) => ({ sku: v.sku, id: v.id })));
      if (taken.length > 0) {
        setTakenSkus(taken);
        showToast(`SKU ${taken[0]} is already used by another variant.`, 'error');
        return false;
      }
    } catch (e) {
      // The database re-checks at Publish; a failed lookup here must not stop the admin, but must not pretend the SKUs were checked either.
      // eslint-disable-next-line no-console
      console.warn('[product wizard] SKU pre-check failed:', e instanceof Error ? e.message : e);
    } finally {
      setCheckingSkus(false);
    }
    return true;
  };

  const saveVariant = async (i: number) => {
    const v = variants[i];
    setShowVariantErrors(true);
    if (Object.keys(variantErrors[i] ?? {}).length > 0) {
      return showToast('Fix the highlighted fields before saving this variant.', 'error');
    }
    if (mode !== 'edit' || !productId) return; // create mode: variants save at Publish
    setSavingVariantIndex(i);
    try {
      const result = await adminRepository.upsertVariant(v.id ?? null, productId, toVariantInput(v));
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

  const cellErrors = (cell: InventoryCell) => ({
    quantity: parseWholeNumber(cell.quantity, 'Opening stock').error,
    reorder: parseWholeNumber(cell.reorderLevel, 'Low-stock alert').error,
  });

  /** Stock errors are shown as soon as something is typed (a negative or fractional number is wrong the moment it appears) and for every field once the admin tries to continue. */
  const stockError = (cell: InventoryCell): { quantity?: string; reorder?: string } => {
    const e = cellErrors(cell);
    const visible = showStockErrors || cell.quantity.trim() !== '' || cell.reorderLevel.trim() !== '';
    const shown: { quantity?: string; reorder?: string } = visible ? e : {};
    if (!shown.quantity && showStockErrors && missingOpeningStock(cell)) {
      return { ...shown, quantity: 'Needs opening stock — every store carries every product.' };
    }
    return shown;
  };

  /**
   * Publishing a new product requires opening stock at EVERY active store. A store with no stock for an item
   * the other store sells is what produced "no store can fulfill your cart" at checkout, so the stores are
   * never allowed to differ at launch (stock can of course run down later; that shows as out of stock).
   */
  const missingOpeningStock = (cell: InventoryCell) =>
    mode === 'create' && (parseWholeNumber(cell.quantity, 'Opening stock').value ?? 0) <= 0;

  const inventoryHasErrors = () =>
    variants.some((_, idx) =>
      (inventory[inventoryKeyFor(idx)] ?? []).some((cell) => {
        const e = cellErrors(cell);
        return !!(e.quantity || e.reorder) || missingOpeningStock(cell);
      }),
    );

  const saveInventoryCell = async (variantId: string, cell: InventoryCell) => {
    const errors = cellErrors(cell);
    if (errors.quantity || errors.reorder) {
      setShowStockErrors(true);
      return showToast(errors.quantity ?? errors.reorder ?? 'Enter a valid quantity.', 'error');
    }
    const qty = parseWholeNumber(cell.quantity, 'Opening stock').value ?? 0;
    const reorder = parseWholeNumber(cell.reorderLevel, 'Low-stock alert').value ?? 5;
    const key = `${variantId}-${cell.storeId}`;
    setSavingInventoryKey(key);
    try {
      await adminRepository.initializeInventory(cell.storeId, variantId, qty, reorder, cell.isAvailable);
      showToast('Inventory saved.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save inventory.', 'error');
    } finally {
      setSavingInventoryKey(null);
    }
  };

  /** The stock rows that are sent with a new product (see services/productWizard.buildInventoryInput). */
  const buildInventoryInput = (): AdminInventoryInput[] =>
    buildInventoryRows(variants.map((_, idx) => inventoryKeyFor(idx)), inventory);

  const publish = async () => {
    if (!image) {
      setShowImageError(true);
      setStep(1);
      return showToast('Add a primary product photo before publishing.', 'error');
    }
    if (variants.length === 0) return showToast('Add at least one variant before publishing.', 'error');
    if (variantErrorsPresent(validateVariants(variants))) {
      setShowVariantErrors(true);
      setStep(2);
      return showToast('Every variant needs its own valid SKU, weight, price and MRP.', 'error');
    }
    if (inventoryHasErrors()) {
      setShowStockErrors(true);
      setStep(3);
      return showToast('Fix the highlighted stock fields before publishing.', 'error');
    }
    // Every variant must have a stock entry for every active store (the cells exist once the Store Inventory step was opened).
    if (stores.length === 0 || variants.some((_, idx) => (inventory[inventoryKeyFor(idx)] ?? []).length < stores.length)) {
      setShowStockErrors(true);
      setStep(3);
      return showToast('Set opening stock for every variant at every store before publishing.', 'error');
    }
    const inventoryInput = buildInventoryInput();
    setPublishing(true);
    try {
      // Photos are uploaded now, one at a time, and only the ones the product really uses.
      const finalImage = await resolveImageForPublish(image);
      const finalGallery: string[] = [];
      for (const uri of gallery) finalGallery.push(await resolveImageForPublish(uri));
      const result = await adminRepository.createProduct({ ...buildProductInput(), image: finalImage, gallery: finalGallery }, variants.map(toVariantInput), inventoryInput);
      published.current = true;
      showToast('Product published.', 'success');
      onPublished?.();
      router.replace(`/admin/products/${result.productId}` as never);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not publish the product.', 'error');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/*
        Each step takes an equal fifth of the width and draws its own half of
        the connector, so the labels can never be pushed into each other (the
        old layout gave every step a fixed 84px plus flexible connectors, which
        overflowed on phone widths). Narrow screens use short labels; the full
        name stays available to screen readers.
      */}
      <View style={styles.stepper}>
        {STEPS.map((label, i) => (
          <Pressable
            key={label}
            style={styles.stepItem}
            onPress={() => setStep(i)}
            disabled={i > step && mode === 'create'}
            accessibilityRole="button"
            accessibilityLabel={`Step ${i + 1} of ${STEPS.length}: ${label}${i < step ? ', completed' : i === step ? ', current step' : ''}`}
          >
            {i > 0 && <View style={[styles.stepLineLeft, i <= step && styles.stepLineDone]} />}
            {i < STEPS.length - 1 && <View style={[styles.stepLineRight, i < step && styles.stepLineDone]} />}
            <View style={[styles.stepDot, i === step && styles.stepDotActive, i < step && styles.stepDotDone]}>
              {i < step ? <Check size={12} color={colors.white} strokeWidth={ICON_STROKE} /> : <Text style={[styles.stepDotText, i === step && styles.stepDotTextActive]}>{i + 1}</Text>}
            </View>
            <Text style={[styles.stepLabel, i === step && styles.stepLabelActive]} numberOfLines={2}>
              {narrowStepper ? STEP_SHORT_LABELS[i] : label}
            </Text>
          </Pressable>
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
            <Text style={styles.stepTitle}>Product Photos</Text>
            <Text style={styles.stepSubtitle}>Take a photo or choose one from your gallery, then crop it before it is saved</Text>
            <ProductImageField
              primary={image}
              gallery={gallery}
              busy={uploading}
              primaryError={showImageError && !image ? 'A primary product photo is required.' : undefined}
              onPrimaryChosen={choosePrimary}
              onGalleryAdded={addGalleryImage}
              onGalleryReplaced={replaceGalleryImage}
              onGalleryRemoved={removeGalleryImage}
              onGalleryMoved={moveGalleryImage}
            />
            {mode === 'create' && (!!image || gallery.length > 0) && <Text style={styles.fieldHint}>Photos stay on this device until you publish the product.</Text>}
          </View>
        )}

        {step === 2 && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Variants &amp; Pricing</Text>
            <View style={styles.infoCard}>
              <Info size={ICON_SIZE.sm} color={colors.goldDark} strokeWidth={ICON_STROKE} />
              <Text style={styles.infoText}>Each pack size is its own variant with its own SKU and price. Example: 100 g, 250 g and 500 g of almonds are three variants.</Text>
            </View>
            {variants.map((v, i) => {
              const name = variantName(v.weightText, v.weight_unit);
              const price = parseDecimal(v.priceText);
              const mrp = parseDecimal(v.mrpText);
              const off = discountPercent(price, mrp);
              return (
                <View key={v.clientId} style={[styles.variantCard, v.is_active === false && styles.variantCardArchived]}>
                  <View style={styles.variantHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.variantCardLabel}>Variant {i + 1}{v.is_active === false ? ' · Archived' : ''}</Text>
                      <Text style={styles.variantTitle} numberOfLines={2}>{name || 'New variant'}{normalizeSku(v.sku) ? ` · ${normalizeSku(v.sku)}` : ''}</Text>
                    </View>
                    <Pressable style={styles.variantActionBtn} onPress={() => duplicateVariant(i)} accessibilityRole="button" accessibilityLabel={`Duplicate variant ${i + 1}`}>
                      <Copy size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                    </Pressable>
                    <Pressable style={styles.variantActionBtn} onPress={() => requestRemoveVariant(i)} accessibilityRole="button" accessibilityLabel={mode === 'edit' && v.id ? `Archive variant ${i + 1}` : `Remove variant ${i + 1}`}>
                      <Trash2 size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
                    </Pressable>
                  </View>

                  <Field label="Weight / pack size *" error={visibleError(i, 'weight')} hint="What the customer buys, e.g. 100, 250 or 500">
                    <View style={styles.weightRow}>
                      <TextInput style={[styles.inputSmall, { flex: 1 }, !!visibleError(i, 'weight') && styles.inputError]} value={v.weightText} onChangeText={(t) => editVariantField(i, 'weight', t)} keyboardType="decimal-pad" placeholder="e.g. 500" placeholderTextColor={colors.textMuted} accessibilityLabel={`Weight for variant ${i + 1}`} />
                      <View style={styles.unitToggle}>
                        {(['g', 'kg'] as const).map((u) => (
                          <Pressable key={u} style={[styles.unitBtn, v.weight_unit === u && styles.unitBtnActive]} onPress={() => updateVariant(i, { weight_unit: u })} accessibilityRole="button" accessibilityState={{ selected: v.weight_unit === u }} accessibilityLabel={u === 'g' ? 'grams' : 'kilograms'}>
                            <Text style={[styles.unitBtnText, v.weight_unit === u && styles.unitBtnTextActive]}>{u}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  </Field>

                  <Field
                    label="SKU — unique code *"
                    error={visibleError(i, 'sku')}
                    hint="Identifies this exact pack size, e.g. GP-ALM-500"
                    tip="A SKU is a short code used for stock and orders. Every variant of every product needs its own, for example GP-ALM-100, GP-ALM-250, GP-ALM-500."
                  >
                    <View style={styles.weightRow}>
                      <TextInput style={[styles.inputSmall, { flex: 1 }, !!visibleError(i, 'sku') && styles.inputError]} value={v.sku} onChangeText={(t) => editVariantField(i, 'sku', t)} placeholder="e.g. GP-ALM-500" placeholderTextColor={colors.textMuted} autoCapitalize="characters" autoCorrect={false} accessibilityLabel={`SKU for variant ${i + 1}`} />
                      <Pressable style={styles.suggestBtn} onPress={() => suggestSkuFor(i)} accessibilityRole="button" accessibilityLabel="Suggest a SKU">
                        <Wand2 size={ICON_SIZE.xs} color={colors.primary} strokeWidth={ICON_STROKE} />
                        <Text style={styles.suggestBtnText}>Suggest</Text>
                      </Pressable>
                    </View>
                  </Field>

                  <View style={styles.pairRow}>
                    <Field label="Selling price (₹) *" style={{ flex: 1 }} error={visibleError(i, 'price')} hint="What the customer pays">
                      <TextInput style={[styles.inputSmall, !!visibleError(i, 'price') && styles.inputError]} value={v.priceText} onChangeText={(t) => editVariantField(i, 'price', t)} keyboardType="decimal-pad" placeholder="e.g. 450" placeholderTextColor={colors.textMuted} accessibilityLabel={`Selling price for variant ${i + 1}`} />
                    </Field>
                    <Field
                      label="MRP (₹) *"
                      style={{ flex: 1 }}
                      error={visibleError(i, 'mrp')}
                      hint={!v.mrpTouched && v.priceText ? 'Follows the price until you edit it' : 'Printed price — not below the selling price'}
                      tip="MRP is the original list price. When it is higher than the selling price, customers see how much they save."
                    >
                      <TextInput style={[styles.inputSmall, !!visibleError(i, 'mrp') && styles.inputError]} value={v.mrpText} onChangeText={(t) => editVariantField(i, 'mrp', t)} keyboardType="decimal-pad" placeholder="e.g. 550" placeholderTextColor={colors.textMuted} accessibilityLabel={`MRP for variant ${i + 1}`} />
                    </Field>
                  </View>
                  {off > 0 && (
                    <View style={styles.saveChip}>
                      <Text style={styles.saveChipText}>Customers save {formatINR(mrp - price)} ({off}% off)</Text>
                    </View>
                  )}
                  {!!sizeNotes[i] && <Text style={styles.noteText}>{sizeNotes[i]}</Text>}
                  <Text style={styles.fieldHint}>
                    {mode === 'edit' && v.id ? (v.is_active === false ? 'Archived: hidden from customers.' : 'Active: customers can buy it where it has stock.') : 'Stock for each store is set in the next step.'}
                  </Text>
                  {mode === 'edit' && (
                    <Pressable style={styles.saveVariantBtn} onPress={() => saveVariant(i)} disabled={savingVariantIndex === i} accessibilityRole="button">
                      {savingVariantIndex === i ? <ActivityIndicator size="small" color={colors.primary} /> : <Check size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} />}
                      <Text style={styles.saveVariantText}>Save this variant</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Pressable style={styles.addVariantBtn} onPress={addVariant} accessibilityRole="button">
              <Plus size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.addVariantText}>{variants.length === 0 ? 'Add the first variant' : 'Add another variant'}</Text>
            </Pressable>
          </View>
        )}

        {step === 3 && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Opening Stock</Text>
            <View style={styles.infoCard}>
              <Info size={ICON_SIZE.sm} color={colors.goldDark} strokeWidth={ICON_STROKE} />
              <Text style={styles.infoText}>Opening stock is how many units each store has on the shelf right now. Every store should carry every product. You can change it later from Inventory.</Text>
            </View>
            {variants.length === 0 && <Text style={styles.emptyHint}>Add variants in the previous step first.</Text>}
            {variants.map((v, idx) => {
              const key = inventoryKeyFor(idx);
              const cells = inventory[key] ?? [];
              const label = variantName(v.weightText, v.weight_unit) || `variant ${idx + 1}`;
              return (
                <View key={key} style={styles.inventoryCard}>
                  <View style={styles.inventoryHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inventoryVariantTitle}>{variantName(v.weightText, v.weight_unit) || `Variant ${idx + 1}`}</Text>
                      <Text style={styles.inventorySku}>SKU {normalizeSku(v.sku) || '—'}</Text>
                    </View>
                    {cells.length > 1 && (
                      <Pressable style={styles.suggestBtn} onPress={() => applyToAllStores(key, cells[0]!.storeId)} accessibilityRole="button" accessibilityLabel={`Use the first store's stock for all stores for ${label}`}>
                        <Copy size={ICON_SIZE.xs} color={colors.primary} strokeWidth={ICON_STROKE} />
                        <Text style={styles.suggestBtnText}>Same at all stores</Text>
                      </Pressable>
                    )}
                  </View>
                  {cells.map((cell) => {
                    const store = stores.find((s) => s.id === cell.storeId);
                    const savingKey = v.id ? `${v.id}-${cell.storeId}` : null;
                    const problems = stockError(cell);
                    const storeLabel = store?.name ?? 'Store';
                    return (
                      <View key={cell.storeId} style={styles.storeBlock}>
                        <View style={styles.storeHeader}>
                          <StoreIcon size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                          {/* The full name, wrapping if it must — never cut off. */}
                          <Text style={styles.inventoryStoreName}>{storeLabel}</Text>
                        </View>
                        <View style={styles.pairRow}>
                          <Field label="Opening stock (units) *" style={{ flex: 1 }} error={problems.quantity} hint="Units on the shelf now, e.g. 50">
                            <TextInput style={[styles.inputSmall, !!problems.quantity && styles.inputError]} value={cell.quantity} onChangeText={(t) => updateInventoryCell(key, cell.storeId, { quantity: t })} keyboardType="number-pad" placeholder="e.g. 50" placeholderTextColor={colors.textMuted} accessibilityLabel={`Opening stock of ${label} at ${storeLabel}`} />
                          </Field>
                          <Field label="Low-stock alert at" style={{ flex: 1 }} error={problems.reorder} hint="Warn me at this many, e.g. 5" tip="When stock falls to this number the product shows as low stock in Inventory, so you can reorder in time.">
                            <TextInput style={[styles.inputSmall, !!problems.reorder && styles.inputError]} value={cell.reorderLevel} onChangeText={(t) => updateInventoryCell(key, cell.storeId, { reorderLevel: t })} keyboardType="number-pad" placeholder="e.g. 5" placeholderTextColor={colors.textMuted} accessibilityLabel={`Low-stock alert level of ${label} at ${storeLabel}`} />
                          </Field>
                        </View>
                        <View style={styles.sellRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.sellLabel}>Sell at this store</Text>
                            <Text style={styles.fieldHint}>{cell.isAvailable ? 'Customers served by this store can buy it.' : "Hidden from this store's customers, even if it has stock."}</Text>
                          </View>
                          <Switch value={cell.isAvailable} onValueChange={(val) => updateInventoryCell(key, cell.storeId, { isAvailable: val })} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} accessibilityLabel={`Sell ${label} at ${storeLabel}`} />
                        </View>
                        {mode === 'edit' && v.id && (
                          <Pressable style={styles.saveVariantBtn} onPress={() => saveInventoryCell(v.id!, cell)} disabled={savingInventoryKey === savingKey} accessibilityRole="button">
                            {savingInventoryKey === savingKey ? <ActivityIndicator size="small" color={colors.primary} /> : <Check size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} />}
                            <Text style={styles.saveVariantText}>Save stock at this store</Text>
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
            <Text style={styles.stepSubtitle}>This is exactly what will be saved</Text>
            <View style={styles.reviewCard}>
              <View style={styles.reviewTop}>
                {!!image && <Image source={{ uri: image }} style={styles.reviewThumb} contentFit="cover" />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.reviewTitle}>{name || 'Untitled product'}</Text>
                  <Text style={styles.reviewMeta}>{categories.find((c) => c.id === categoryId)?.name ?? 'No category'} • {brand}</Text>
                  <Text style={styles.reviewMeta}>{gallery.length} gallery photo{gallery.length === 1 ? '' : 's'} • {variants.length} variant{variants.length === 1 ? '' : 's'}</Text>
                </View>
              </View>
            </View>
            {variants.map((v, i) => {
              const price = parseDecimal(v.priceText) || 0;
              const mrp = parseDecimal(v.mrpText) || 0;
              const off = discountPercent(price, mrp);
              const lines = reviewStockLines(inventory[inventoryKeyFor(i)] ?? [], storeNames);
              return (
                <View key={v.clientId} style={styles.reviewVariant}>
                  <Text style={styles.reviewVariantTitle}>{variantName(v.weightText, v.weight_unit) || `Variant ${i + 1}`} · {normalizeSku(v.sku)}</Text>
                  <View style={styles.reviewPriceRow}>
                    <Text style={styles.reviewPrice}>Selling price {formatINR(price)}</Text>
                    <Text style={styles.reviewMrp}>MRP {formatINR(mrp)}{off > 0 ? ` (${off}% off)` : ''}</Text>
                  </View>
                  {lines.length === 0 ? (
                    <Text style={styles.noteText}>No stock entered yet.</Text>
                  ) : (
                    lines.map((line) => (
                      <Text key={line.storeName} style={styles.reviewStockLine}>
                        {line.storeName}: <Text style={styles.reviewStockStrong}>{line.units} units</Text>{line.sellable ? '' : ' (not sold here)'} · alert at {line.lowStockAlert}
                      </Text>
                    ))
                  )}
                </View>
              );
            })}
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
        <Pressable style={styles.footerBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel={step === 0 ? 'Back to the previous screen' : 'Back to the previous step'}>
          <Text style={styles.footerBtnText}>Back</Text>
        </Pressable>
        {step < STEPS.length - 1 && (
          <Pressable style={styles.footerBtnPrimary} onPress={goNext} disabled={savingBasic || checkingSkus}>
            {savingBasic || checkingSkus ? <ActivityIndicator color={colors.white} /> : <Text style={styles.footerBtnPrimaryText}>Next</Text>}
          </Pressable>
        )}
      </View>

      <GPConfirmModal
        visible={variantToRemove !== null}
        onClose={() => setVariantToRemove(null)}
        destructive
        title={variantToRemove !== null && mode === 'edit' && variants[variantToRemove]?.id ? 'Archive this variant?' : 'Remove this variant?'}
        message={
          variantToRemove !== null && mode === 'edit' && variants[variantToRemove]?.id
            ? 'It will be hidden from customers. Its order history is kept.'
            : 'Its SKU, price and the stock you entered for each store will be lost.'
        }
        primaryLabel={variantToRemove !== null && mode === 'edit' && variants[variantToRemove]?.id ? 'Archive' : 'Remove'}
        onPressPrimary={() => {
          const i = variantToRemove;
          setVariantToRemove(null);
          if (i === null) return;
          if (mode === 'edit' && variants[i]?.id) void archiveVariant(i);
          else removeVariant(i);
        }}
        secondaryLabel="Keep"
        onPressSecondary={() => setVariantToRemove(null)}
      />

      <GPConfirmModal
        visible={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this product?"
        message="You've started adding a product. If you leave now, what you've entered will be lost."
        primaryLabel="Discard"
        destructive
        onPressPrimary={() => {
          setConfirmDiscard(false);
          leaveWizard();
        }}
        secondaryLabel="Keep Editing"
        onPressSecondary={() => setConfirmDiscard(false)}
      />

    </KeyboardAvoidingView>
  );
}

/** A labelled field with an example/helper line, an optional (i) tip for unfamiliar terms, and its error. */
function Field({ label, children, style, error, hint, tip }: { label: string; children: React.ReactNode; style?: object; error?: string; hint?: string; tip?: string }) {
  const [showTip, setShowTip] = useState(false);
  return (
    <View style={[styles.field, style]}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {!!tip && (
          <Pressable onPress={() => setShowTip((s) => !s)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`What is ${label.replace(/[*—].*$/, '').trim()}?`} accessibilityState={{ expanded: showTip }}>
            <Info size={14} color={showTip ? colors.primary : colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
        )}
      </View>
      {showTip && !!tip && <Text style={styles.tipBox}>{tip}</Text>}
      {children}
      {error ? (
        <Text style={styles.fieldError} accessibilityLiveRegion="polite">{error}</Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  stepItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  stepLineLeft: { position: 'absolute', top: 12, left: 0, right: '50%', height: 2, backgroundColor: colors.border },
  stepLineRight: { position: 'absolute', top: 12, left: '50%', right: 0, height: 2, backgroundColor: colors.border },
  stepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  stepDotActive: { backgroundColor: colors.primary },
  stepDotDone: { backgroundColor: colors.success },
  stepDotText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_700Bold' },
  stepDotTextActive: { color: colors.white },
  stepLabel: { ...textStyles.caption, fontSize: 10, lineHeight: 13, color: colors.textMuted, textAlign: 'center', alignSelf: 'stretch' },
  stepLabelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  stepLineDone: { backgroundColor: colors.success },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xxl, maxWidth: 720, width: '100%', alignSelf: 'center' },
  section: { gap: spacing.md },
  stepTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary, marginTop: -4 },
  stepSubtitle: { ...textStyles.bodySmall, color: colors.textSecondary, marginTop: -8, marginBottom: 4 },
  field: { gap: 6 },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  fieldError: { ...textStyles.caption, fontSize: 11, color: colors.error },
  fieldHint: { ...textStyles.caption, fontSize: 11, color: colors.textMuted },
  inputError: { borderColor: colors.error },
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
  variantCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  variantCardArchived: { opacity: 0.5 },
  variantCardLabel: { ...textStyles.caption, color: colors.goldDark, fontFamily: 'PlusJakartaSans_700Bold', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10.5 },
  unitToggle: { flexDirection: 'row', gap: 4, width: 96 },
  unitBtn: { flex: 1, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  unitBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  unitBtnText: { ...textStyles.caption, color: colors.textSecondary },
  unitBtnTextActive: { color: colors.white },
  // 40x40 (not the previous 34x34 + hitSlop): these two buttons sit only
  // 8px apart, so a hitSlop generous enough to reach 40x40's worth of
  // touch area would have made their hit zones overlap and made "Save"
  // vs "Delete" ambiguous right at the boundary — sizing the box itself
  // up is the safe fix here, not hitSlop.
  variantActionBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.goldTint, borderRadius: radius.md, padding: spacing.md },
  infoText: { ...textStyles.caption, flex: 1, color: colors.textPrimary, lineHeight: 17 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tipBox: { ...textStyles.caption, fontSize: 11.5, lineHeight: 16, color: colors.textPrimary, backgroundColor: colors.surfaceSunken, borderRadius: radius.sm, padding: spacing.sm },
  variantHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  variantTitle: { ...textStyles.cardTitle, fontSize: 15, color: colors.textPrimary, marginTop: 2 },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pairRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  suggestBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 42, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.primaryTint },
  suggestBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  saveChip: { alignSelf: 'flex-start', backgroundColor: colors.successTint, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  saveChipText: { ...textStyles.caption, color: colors.success, fontFamily: 'PlusJakartaSans_700Bold' },
  noteText: { ...textStyles.caption, color: colors.warning },
  saveVariantBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.success, backgroundColor: colors.surface },
  saveVariantText: { ...textStyles.button, fontSize: 13, color: colors.success },
  inventoryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inventorySku: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  storeBlock: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md },
  storeHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  sellRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sellLabel: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  reviewThumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceSunken },
  reviewVariant: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  reviewVariantTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  reviewPriceRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md },
  reviewPrice: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  reviewMrp: { ...textStyles.bodySmall, color: colors.textSecondary },
  reviewStockLine: { ...textStyles.caption, color: colors.textSecondary, lineHeight: 17 },
  reviewStockStrong: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  addVariantBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: radius.md, height: 46 },
  addVariantText: { ...textStyles.button, color: colors.primary, fontSize: 13 },
  inventoryCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  inventoryVariantTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  inventoryStoreName: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  emptyHint: { ...textStyles.bodySmall, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl },
  reviewCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, gap: 4, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  reviewTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  reviewMeta: { ...textStyles.caption, color: colors.textSecondary },
  publishBtn: { backgroundColor: colors.primary, borderRadius: radius.md, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  publishBtnText: { ...textStyles.button, color: colors.white, fontSize: 15 },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  footerBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  footerBtnText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  footerBtnPrimary: { flex: 2, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  footerBtnPrimaryText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
