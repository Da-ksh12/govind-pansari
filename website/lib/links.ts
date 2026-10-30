// Small pure rules about links and offers that the storefront data layer depends on. Kept free of framework imports so they can be tested.

/** Only same-site paths and https links are followed; anything else (javascript:, data:, protocol-relative //evil) falls back. */
export function safeHref(value: string | null | undefined, fallback = '/shop'): string {
  const v = value?.trim();
  if (!v) return fallback;
  if (v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\')) return v;
  try {
    return new URL(v).protocol === 'https:' ? v : fallback;
  } catch {
    return fallback;
  }
}

/** The admin's banner targets point at app screens ("/category/x", "/product/x", "/(tabs)/categories"); map them onto website routes. */
export function websitePath(target: string | null | undefined): string {
  const v = target?.trim();
  if (!v) return '/shop';
  if (/^https:\/\//i.test(v)) return safeHref(v);
  if (v.startsWith('/(tabs)') || v.startsWith('/tabs')) return '/shop';
  if (v === '/build-your-box') return '/gift-hampers';
  return safeHref(v);
}

/**
 * Coupons are not applied by the checkout (the server order total has no coupon step), so an offer that tells customers to "use code X" would
 * promise a discount they can never get. Such offers are kept off the website until coupons really work.
 */
export function mentionsCouponCode(text: string): boolean {
  return /\b(?:coupon|promo)\b/i.test(text) || /\b[A-Z]{4,}\d{1,4}\b/.test(text);
}

/**
 * Where to send someone after they sign in. Only a path on this site is accepted; anything else (another site, "//evil.example", a javascript: URL,
 * a path that bounces back to the login page) becomes the account page, so a crafted ?next= can never turn the login into an open redirect.
 */
export function safeNext(value: string | null | undefined, fallback = '/account'): string {
  const v = value?.trim();
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || /[\r\n]/.test(v)) return fallback;
  if (v === '/login' || v.startsWith('/login?') || v.startsWith('/login/')) return fallback;
  return v;
}
