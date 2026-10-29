// The admin panel's layout and flows, pinned at the places where they went wrong: the Inventory list that would not scroll, the
// image picker that offered only one source, wizard fields without labels, and the cramped order rows. The screens cannot be
// rendered in these tests, so this checks the wiring that makes each behaviour true.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
/** The JSX between <AdminShell ...> and the first <FlatList (what is rendered ABOVE the list as a fixed block). */
const aboveFirstList = (text) => text.slice(text.indexOf('<AdminShell'), text.indexOf('<FlatList'));

test('Inventory scrolls as one list: stats, search and filters are the list\'s header, not a fixed block above it', () => {
  const inventory = source('app/admin/inventory.tsx');
  assert.match(inventory, /ListHeaderComponent=\{header\}/);
  const above = aboveFirstList(inventory);
  for (const fixed of ['<StatCard', 'styles.toolbar', '<TextInput', 'FilterChipRow']) assert.ok(!above.includes(fixed), `${fixed} is still fixed above the Inventory list`);
  assert.match(inventory, /const header = \(/);
  assert.match(inventory, /<StatCard compact/);
  // One list owns the scroll: no nested vertical ScrollView around it, and the keyboard does not trap touches.
  assert.doesNotMatch(inventory.slice(inventory.indexOf('export default function')), /<ScrollView(?![^>]*horizontal)[^>]*>\s*<FlatList/);
  assert.match(inventory, /keyboardShouldPersistTaps="handled"/);
  assert.match(inventory, /keyboardDismissMode="on-drag"/);
});

test('the same fix is applied everywhere the shell had a tall fixed block above a list', () => {
  for (const file of ['app/admin/orders/index.tsx', 'app/admin/products/index.tsx', 'app/admin/riders.tsx']) {
    const text = source(file);
    assert.match(text, /ListHeaderComponent=\{header\}/, `${file} must put its header inside the list`);
    const above = aboveFirstList(text);
    assert.ok(!above.includes('<StatCard') && !above.includes('styles.toolbar') && !above.includes('<TextInput'), `${file} still has a fixed block above the list`);
  }
  const deliveries = source('app/admin/deliveries.tsx');
  assert.match(deliveries, /ListHeaderComponent=\{toolbar\}/);
  assert.match(deliveries, /ListHeaderComponent=\{\s*<>\s*\{toolbar\}/, 'the needs-rider list keeps its hint AND gets the toolbar');
  assert.match(deliveries, /view === 'map' && <View style=\{styles\.mapToolbarWrap\}>/, 'only the map keeps a fixed bar');
  const shell = source('components/admin/AdminShell.tsx');
  assert.match(shell, /main: \{ flex: 1, minHeight: 0 \}/);
  assert.match(shell, /content: \{ flex: 1, minHeight: 0/);
});

test('filters take one line: a scrolling chip row instead of a wrapping block', () => {
  assert.match(source('components/admin/FilterChipRow.tsx'), /horizontal/);
  assert.match(source('app/admin/orders/index.tsx'), /<FilterChipRow/);
  assert.match(source('app/admin/inventory.tsx'), /<FilterChipRow/);
  assert.doesNotMatch(source('app/admin/orders/index.tsx'), /flexWrap: 'wrap'/);
});

test('Orders: cards (not squeezed columns), real item previews, responsive columns, search + pagination kept', () => {
  const list = source('app/admin/orders/index.tsx');
  assert.match(list, /<OrderCard/);
  assert.match(list, /adminRepository\s*\.getOrderPreviews/);
  assert.match(list, /columns = width >= 1100 \? 3 : width >= 700 \? 2 : 1/);
  assert.match(list, /numColumns=\{columns\}/);
  assert.match(list, /onEndReached=\{loadMore\}/);
  assert.match(list, /useDebouncedValue\(searchInput/);
  assert.match(list, /loadError/);
  const card = source('components/admin/OrderCard.tsx');
  for (const part of ['order.order_number', 'order.customer_name', 'formatPhone(order.customer_phone)', 'formatMoney(order.total)', 'itemCountText(order.item_count)', 'order.store_name', 'formatOrderDateTime(order.placed_at)', 'StatusBadge', 'ChevronRight', 'mainLineTitle', 'moreItemsText']) {
    assert.ok(card.includes(part), `the order card must show ${part}`);
  }
  // The total can never wrap onto two lines ("₹1,00 / 0" in the old narrow column).
  assert.match(card, /<Text style=\{styles\.total\} numberOfLines=\{1\}>/);
  // No made-up picture: with no stored photo the neutral placeholder is shown.
  assert.match(card, /uri=\{main\?\.image \?\? null\}/);
  assert.match(card, /Items unavailable/);
});

test('Order details: real items with photos, stored money, payment, address, store, rider, timeline; allowed actions only', () => {
  const detail = source('app/admin/orders/[id].tsx');
  for (const call of ['getOrderDetail', 'getOrderLines', 'getOrderPayment']) assert.ok(detail.includes(`adminRepository.${call}`) || detail.includes(`.${call}(`), `detail must load ${call}`);
  for (const part of ['priceBreakdown(order)', 'describePayment(', 'addressLines(address)', 'cleanTimeline(', 'allowedOrderActions(', 'detail.store', 'delivery.riderName', 'line.image', 'Price details', 'Fulfilling store']) {
    assert.ok(detail.includes(part), `detail must include ${part}`);
  }
  assert.match(detail, /actions\.canCancel/);
  assert.match(detail, /actions\.canAssignRider/);
  // Cancel confirms with a modal that also works on the admin web panel (Alert.alert does nothing there).
  assert.match(detail, /<GPConfirmModal/);
  assert.doesNotMatch(detail, /Alert\.alert/);
  // Loading, empty and error states exist.
  assert.match(detail, /Couldn't load this order/);
  assert.match(detail, /Loading items…/);
});

test('Photos: Take Photo and Choose from Gallery are both offered, for the primary photo and the gallery', () => {
  const field = source('components/admin/ProductImageField.tsx');
  assert.equal((field.match(/label="Take Photo"/g) ?? []).length >= 2, true, 'Take Photo on both the empty and the filled primary photo');
  assert.equal((field.match(/label="Choose from Gallery"/g) ?? []).length >= 2, true);
  assert.match(field, /title="Take Photo"/);
  assert.match(field, /title="Choose from Gallery"/);
  // Gallery: preview, replace, reorder, remove (with a confirmation).
  for (const item of ['title="Preview"', 'title="Replace"', 'title="Move earlier"', 'title="Move later"', 'title="Remove"', 'GPConfirmModal']) assert.ok(field.includes(item), item);
  // Permission states.
  assert.match(field, /canOpenSettings/);
  assert.match(field, /Linking\.openSettings\(\)/);
  assert.match(field, /canRetry/);
  // Every picked photo is edited before it is kept.
  assert.match(field, /<ImageEditorModal/);
  assert.match(field, /onApply=\{onEdited\}/);
});

test('The camera is requested only while the prompt can still appear, and the gallery needs no storage permission', () => {
  const images = source('services/storage/productImages.ts');
  const camera = images.slice(images.indexOf('export async function capturePhoto'), images.indexOf('export async function pickFromGallery'));
  assert.match(camera, /getCameraPermissionsAsync/);
  assert.match(camera, /if \(!snapshot\.granted && snapshot\.canAskAgain\)/);
  assert.match(camera, /ImagePermissionError/);
  const gallery = images.slice(images.indexOf('export async function pickFromGallery'), images.indexOf('export async function pickProductImage'));
  assert.doesNotMatch(gallery, /requestMediaLibraryPermissionsAsync/);
  assert.match(gallery, /allowsMultipleSelection: limit > 1/);
  assert.match(source('app.json'), /"cameraPermission": "[^"]*store admins can photograph products/);
});

test('The editor has crop, zoom, reposition, rotate, reset, preview, apply and cancel, and its own gesture root inside the Modal', () => {
  const editor = source('components/admin/ImageEditorModal.tsx');
  for (const part of ['Gesture.Pinch()', 'Gesture.Pan()', 'GestureHandlerRootView', 'ASPECTS.map', 'label="Rotate"', 'label="Reset"', "'Back to editing' : 'Preview'", 'accessibilityLabel="Apply edits"', 'accessibilityLabel="Cancel editing"', 'label="Zoom in"', 'label="Zoom out"', 'renderEditedImage(', 'prepareForEditing(']) {
    assert.ok(editor.includes(part), `editor must include ${part}`);
  }
  // Loading, load-error and apply-error states.
  assert.match(editor, /Preparing your photo/);
  assert.match(editor, /Couldn't open this photo/);
  assert.match(editor, /applyError/);
  // A failed photo can be retried without an effect loop.
  assert.match(editor, /setRetryTick/);
  assert.doesNotMatch(editor, /loadError === null\]/);
  // The saved file is resized, cropped and rotated by the real manipulator, JPEG, never the raw camera file.
  const processing = source('services/storage/imageProcessing.ts');
  assert.match(processing, /ImageManipulator\.manipulate/);
  assert.match(processing, /\.rotate\(turns \* 90\)/);
  assert.match(processing, /\.crop\(crop\)/);
  assert.match(processing, /SaveFormat\.JPEG/);
});

test('Photos are not uploaded until they are needed: no orphans, no duplicates, no loss between steps', () => {
  const wizard = source('components/admin/ProductWizard.tsx');
  assert.match(wizard, /import \{ ProductImageField \} from '\.\/ProductImageField'/);
  assert.doesNotMatch(wizard, /pickProductImage/);
  // Create mode keeps drafts on the device (no upload while editing the form)…
  assert.match(wizard, /if \(mode === 'create'\) \{\s*draftBase64\.current\.set\(edited\.uri, edited\.base64\);\s*return edited\.uri;/);
  // …and uploads each one exactly once at Publish, remembering what it already uploaded for a retry.
  assert.match(wizard, /const known = uploadedForDraft\.current\.get\(uri\);\s*if \(known\) return known;/);
  assert.match(wizard, /for \(const uri of gallery\) finalGallery\.push\(await resolveImageForPublish\(uri\)\)/);
  assert.match(wizard, /published\.current = true/);
  // Files uploaded for a product that was never published are deleted when the wizard is left.
  assert.match(wizard, /if \(published\.current\) return;\s*for \(const url of uploadedForDraft\.current\.values\(\)\) deleteProductImage\(url\)/);
  // A replaced / removed photo's file goes only after the product record stopped pointing at it (edit mode).
  assert.match(wizard, /if \(await persistImages\(url, gallery\)\) \{\s*if \(previous && previous !== url\) discardImage\(previous\);/);
  // One photo change at a time: a second tap cannot start a second upload.
  assert.match(wizard, /if \(uploading\) return;\s*setUploading\(true\)/);
  // The state lives in the one wizard component, so Back / Next keeps everything.
  assert.match(wizard, /Photos stay on this device until you publish the product/);
});

test('Variants and Stock: every field is labelled with an example, store names are whole, and the review shows what is saved', () => {
  const wizard = source('components/admin/ProductWizard.tsx');
  for (const label of ['Weight / pack size *', 'SKU — unique code *', 'Selling price (₹) *', 'MRP (₹) *', 'Opening stock (units) *', 'Low-stock alert at', 'Sell at this store']) {
    assert.ok(wizard.includes(label), `missing label: ${label}`);
  }
  for (const example of ['e.g. 500', 'e.g. GP-ALM-500', 'e.g. 450', 'e.g. 550', 'e.g. 50', 'e.g. 5']) assert.ok(wizard.includes(`placeholder="${example}"`), `missing example ${example}`);
  assert.match(wizard, /Opening stock is how many units each store has on the shelf right now/);
  // Variant actions: add, duplicate, remove/archive with a confirmation when data could be lost.
  for (const part of ['duplicateVariant(i)', 'requestRemoveVariant(i)', 'Add another variant', 'Remove this variant?', 'Archive this variant?', 'Same at all stores', 'suggestSkuFor(i)']) assert.ok(wizard.includes(part), part);
  // The full store name: no numberOfLines on it.
  assert.match(wizard, /<Text style=\{styles\.inventoryStoreName\}>\{storeLabel\}<\/Text>/);
  // Review: SKU, variant name, price, MRP and stock per store, from the same helpers that build what is saved.
  assert.match(wizard, /reviewStockLines\(inventory\[inventoryKeyFor\(i\)\] \?\? \[\], storeNames\)/);
  assert.match(wizard, /buildInventoryRows\(variants\.map\(\(_, idx\) => inventoryKeyFor\(idx\)\), inventory\)/);
  // A variant's stock goes with it when the variant is removed.
  assert.match(wizard, /const \{ \[key\]: _gone, \.\.\.rest \} = prev;/);
});
