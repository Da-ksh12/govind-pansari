/**
 * Image source selection kept free of React Native so it can be unit-tested
 * (tests/unit/image-sources.test.mjs). AppImage walks the list returned by
 * imageSources() until one source loads; only when all of them fail does it
 * show the branded fallback tile.
 */

/** Non-empty, de-duplicated URLs in priority order. */
export function imageSources(...candidates: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const candidate of candidates) {
    const url = candidate?.trim();
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * An order line keeps a frozen image snapshot taken when the order was placed.
 * That snapshot is empty when the product had no photo at the time, and can
 * point at a file that has since been deleted — so the product's current photo
 * is offered as the fallback, and used outright when there is no snapshot.
 */
export function orderItemImages(
  snapshot: string | null | undefined,
  currentProductImage: string | null | undefined,
): { image: string; fallbackImage?: string } {
  const [image = '', fallbackImage] = imageSources(snapshot, currentProductImage);
  return fallbackImage ? { image, fallbackImage } : { image };
}
