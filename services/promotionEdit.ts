// Editing the home-screen banners and offers: what is accepted (the same rules admin_save_banner / admin_save_offer enforce — so the admin is told
// before the round trip) and the parameters to send. Pure, so tests/unit covers it.
import { parseDateInput } from './dateInput';

export type PromotionTargetType = 'none' | 'category' | 'product' | 'url';

export const OFFER_CATEGORIES = [
  { value: 'first_order', label: 'First order' },
  { value: 'combo', label: 'Combo' },
  { value: 'festival', label: 'Festival' },
  { value: 'free_delivery', label: 'Free delivery' },
  { value: 'premium', label: 'Premium' },
  { value: 'gifting', label: 'Gifting' },
] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number]['value'];

/** A page inside the app: one leading "/", then a real path — never "//host", "..", "/./" or spaces. Same rule as the database. */
export function isInAppLink(url: string): boolean {
  return /^\/([A-Za-z0-9_?=&-][A-Za-z0-9/_?=&.-]*)?$/.test(url) && !url.includes('..') && url.length <= 200;
}

const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');

export interface PromotionFormInput {
  title: string;
  subtitle: string;
  imageUrl: string;
  ctaLabel: string;
  targetType: PromotionTargetType;
  targetId: string | null;
  startDate: string;
  endDate: string;
  sortOrder: string;
  isActive: boolean;
}
export interface BannerFormInput extends PromotionFormInput {
  eyebrow: string;
  theme: 'dark' | 'light';
  targetUrl: string;
}
export interface OfferFormInput extends PromotionFormInput {
  category: OfferCategory | null;
}

export type PromotionErrors = Partial<Record<'title' | 'subtitle' | 'eyebrow' | 'imageUrl' | 'ctaLabel' | 'target' | 'targetUrl' | 'startDate' | 'endDate' | 'sortOrder' | 'category', string>>;

interface Common {
  title: string;
  subtitle: string | null;
  imageUrl: string;
  ctaLabel: string | null;
  startAt: string | null;
  endAt: string | null;
  sortOrder: number;
  targetType: PromotionTargetType;
  targetId: string | null;
  isActive: boolean;
}

function validateCommon(input: PromotionFormInput, errors: PromotionErrors): Common {
  const title = collapse(input.title);
  if (title.length < 1 || title.length > 80) errors.title = 'Enter a title (up to 80 characters).';
  const subtitle = collapse(input.subtitle);
  if (subtitle.length > 140) errors.subtitle = 'The subtitle can be at most 140 characters.';
  const imageUrl = input.imageUrl.trim();
  if (!/^https:\/\/\S+$/.test(imageUrl) || imageUrl.length > 500) errors.imageUrl = 'Add a picture.';
  const ctaLabel = collapse(input.ctaLabel);
  if (ctaLabel.length > 24) errors.ctaLabel = 'The button text can be at most 24 characters.';

  let startAt: string | null = null;
  if (input.startDate.trim()) {
    startAt = parseDateInput(input.startDate, 'start');
    if (!startAt) errors.startDate = 'Enter a date like 25-12-2026.';
  }
  let endAt: string | null = null;
  if (input.endDate.trim()) {
    endAt = parseDateInput(input.endDate, 'end');
    if (!endAt) errors.endDate = 'Enter a date like 31-12-2026, or leave it empty for no end.';
    else if (startAt && endAt <= startAt) errors.endDate = 'The end date must be after the start date.';
  }

  const sortText = input.sortOrder.trim() === '' ? '0' : input.sortOrder.trim();
  const sortOrder = /^\d{1,4}$/.test(sortText) ? Number(sortText) : NaN;
  if (!Number.isInteger(sortOrder) || sortOrder > 1000) errors.sortOrder = 'Enter a number from 0 to 1000 (smaller shows first).';

  if ((input.targetType === 'category' || input.targetType === 'product') && !input.targetId) {
    errors.target = input.targetType === 'category' ? 'Choose the category it opens.' : 'Choose the product it opens.';
  }

  return {
    title,
    subtitle: subtitle || null,
    imageUrl,
    ctaLabel: ctaLabel || null,
    startAt,
    endAt,
    sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    targetType: input.targetType,
    targetId: input.targetType === 'category' || input.targetType === 'product' ? input.targetId : null,
    isActive: input.isActive,
  };
}

export function validateBannerForm(input: BannerFormInput): { errors: PromotionErrors; value: Common & { eyebrow: string | null; theme: 'dark' | 'light'; targetUrl: string | null } } {
  const errors: PromotionErrors = {};
  const common = validateCommon(input, errors);
  const eyebrow = collapse(input.eyebrow);
  if (eyebrow.length > 24) errors.eyebrow = 'The small heading can be at most 24 characters.';
  const targetUrl = input.targetType === 'url' ? input.targetUrl.trim() : '';
  if (input.targetType === 'url' && !isInAppLink(targetUrl)) errors.targetUrl = 'Use a page inside the app, like /category/almonds.';
  return { errors, value: { ...common, eyebrow: eyebrow || null, theme: input.theme, targetUrl: input.targetType === 'url' ? targetUrl : null } };
}

export function validateOfferForm(input: OfferFormInput): { errors: PromotionErrors; value: Common & { category: OfferCategory | null } } {
  const errors: PromotionErrors = {};
  const common = validateCommon(input, errors);
  if (!input.category) errors.category = 'Choose what kind of offer this is.';
  // an offer can open a category or a product; a "link" target does not exist for offers
  return { errors, value: { ...common, targetType: input.targetType === 'url' ? 'none' : common.targetType, category: input.category } };
}
