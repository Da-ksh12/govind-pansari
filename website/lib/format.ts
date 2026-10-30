// Small, pure formatting helpers shared by every page. No framework imports, so tests/ can run them directly.

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrExact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,299 — whole rupees show without paise, anything with paise shows both digits (₹49.50). Never NaN: bad input reads as ₹0. */
export function formatINR(amount: number): string {
  if (!Number.isFinite(amount)) return inr.format(0);
  return Number.isInteger(amount) ? inr.format(amount) : inrExact.format(amount);
}

/** The discount percentage to advertise, rounded to a whole number — 0 whenever there is no real saving (MRP missing, equal or lower than the price). */
export function discountPercent(price: number, mrp: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(mrp) || mrp <= 0 || price < 0 || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

/** "250 g", "1 kg", "1.5 kg" — trailing zeros trimmed. */
export function weightLabel(value: number, unit: string): string {
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  return `${text} ${unit}`;
}

/** A weight as grams, so variants sort 250 g < 500 g < 1 kg whatever unit each is stored in. */
export function weightInGrams(value: number, unit: string): number {
  return unit === 'kg' ? value * 1000 : value;
}

/** "5 Nov 2026, 3:30 pm" in India time, whatever time zone the browser or server is in. */
export function formatDateTimeIST(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date).replace(/\s?(am|pm)/i, (m) => m.toLowerCase());
}

/** Plural helper: pluralize(1, 'item') -> "1 item", pluralize(3, 'item') -> "3 items". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
