import type { Option } from '@/components/ui';

/** Expense categories, same values and labels as the web portal's expenseForm. */
export const EXPENSE_CATEGORIES: Option<string>[] = [
  { value: 'medical', label: 'Medical / dental' },
  { value: 'school', label: 'School / tuition' },
  { value: 'childcare', label: 'Childcare' },
  { value: 'activities', label: 'Activities / sports' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'travel', label: 'Travel' },
  { value: 'other', label: 'Other' },
];

export function categoryLabel(value: string): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** Quick picks for the payment method field (free text is still allowed, max 60 chars). */
export const PAYMENT_METHODS = ['Zelle', 'Venmo', 'PayPal', 'Check', 'Cash', 'Bank transfer'] as const;

/**
 * Parse a dollar amount typed on a decimal keyboard ('12', '12.5', '12,50', '$1,200.00').
 * Returns the normalized string the API accepts ('12.50') or null when invalid / not > 0.
 */
export function parseDollars(input: string): string | null {
  let s = input.trim().replace(/^\$/, '').replace(/\s/g, '');
  // '1,200.50' -> thousands separator; '12,50' -> decimal comma
  if (/^\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

/** Dollars string -> integer cents (0 when invalid). */
export function dollarsToCents(input: string): number {
  const d = parseDollars(input);
  return d ? Math.round(Number(d) * 100) : 0;
}
