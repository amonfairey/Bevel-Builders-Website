import { useRef, useState } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import {
  AppText, Button, Callout, Checkbox, DateField, EmptyState, Field, HeaderButton, MultiSelect, Screen, Select, useAttempt,
} from '@/components/ui';
import { EXPENSE_CATEGORIES, dollarsToCents, parseDollars } from '@/components/money/constants';
import { ReceiptPicker } from '@/components/money/ReceiptPicker';
import { api } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { isDate, money, todayLocal } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { FilePayload, IdResponse } from '@/lib/types';

/**
 * Add an expense (iOS sheet). Params: ?eventId=&description=&amount= (from "Log a cost" on
 * an activity) and optionally &children=1,2 and &date=YYYY-MM-DD.
 */
export default function NewExpenseScreen() {
  const params = useLocalSearchParams<{ eventId?: string; description?: string; amount?: string; children?: string; date?: string }>();
  const { me, tz, other, isParent } = usePeople();
  const attempt = useAttempt();
  const badges = useBadges();

  const eventId = params.eventId && /^\d+$/.test(params.eventId) ? Number(params.eventId) : null;
  const preKids = params.children ? params.children.split(',').map(Number).filter((n) => me.children.some((c) => c.id === n)) : null;

  const [description, setDescription] = useState(params.description ?? '');
  const [amount, setAmount] = useState(params.amount ? (parseDollars(params.amount) ?? params.amount) : '');
  const [date, setDate] = useState(params.date && isDate(params.date) ? params.date : todayLocal(tz));
  const [category, setCategory] = useState<string>(eventId ? 'activities' : 'other');
  const [kids, setKids] = useState<number[]>(preKids ?? me.children.map((c) => c.id));
  const [share, setShare] = useState(String(100 - me.family.default_split));
  const [receipt, setReceipt] = useState<FilePayload | null>(null);
  const [request, setRequest] = useState(true);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const otherName = other?.name ?? 'Other parent';
  const shareNum = /^\d{1,3}$/.test(share.trim()) ? Number(share.trim()) : NaN;
  const amountCents = dollarsToCents(amount);
  const owed = Number.isFinite(shareNum) && amountCents ? Math.round((amountCents * shareNum) / 100) : null;

  const close = () => (router.canGoBack() ? router.back() : router.replace(routes.money as Href));

  const save = async () => {
    if (busy.current) return;
    const errs: Record<string, string | null> = {};
    if (!description.trim()) errs.description = 'Describe the expense';
    const dollars = parseDollars(amount);
    if (!dollars) errs.amount = 'Enter an amount greater than zero, like 45.99';
    if (!isDate(date)) errs.date = 'Choose a date';
    if (!Number.isFinite(shareNum) || shareNum < 0 || shareNum > 100) errs.share = 'Enter a whole number from 0 to 100';
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    busy.current = true;
    setSaving(true);
    try {
      const r = await attempt(() => api.post<IdResponse>('/api/expenses', {
        description: description.trim(), amount: dollars, date, category, child_ids: kids, other_share_pct: shareNum,
        request_reimbursement: request, event_id: eventId, receipt,
      }), request && other ? `Saved. ${other.name} will be asked to approve.` : 'Expense saved');
      if (r) { void badges.refresh(); close(); }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  if (!isParent) {
    return (
      <Screen headerTitle="Add expense">
        <EmptyState icon="eye-outline" title="View-only access" message="Only the two parents can add expenses." />
      </Screen>
    );
  }

  return (
    <Screen headerTitle="Add expense" headerRight={() => <HeaderButton title="Save" bold onPress={save} disabled={saving} testID="expense-save-header" />} testID="expense-new">
      {eventId ? <Callout tone="accent">Logging a cost for an activity. It will be linked to that activity.</Callout> : null}
      <Field label="What was it for" value={description} onChangeText={(v) => { setDescription(v); setErrors((e) => ({ ...e, description: null })); }}
        placeholder="e.g. Soccer cleats" error={errors.description} maxLength={300} returnKeyType="next" testID="expense-description" />
      <Field label="Amount ($)" value={amount} onChangeText={(v) => { setAmount(v); setErrors((e) => ({ ...e, amount: null })); }}
        placeholder="0.00" keyboardType="decimal-pad" inputMode="decimal" error={errors.amount} testID="expense-amount" />
      <DateField label="Date" value={date} onChange={setDate} error={errors.date} max={todayLocal(tz)} testID="expense-date" />
      <Select label="Category" value={category} options={EXPENSE_CATEGORIES} onChange={setCategory} testID="expense-category" />
      {me.children.length ? (
        <MultiSelect label="For" options={me.children.map((c) => ({ value: c.id, label: c.name }))} values={kids} onChange={setKids} />
      ) : null}
      <Field label={`${otherName}'s share (%)`} value={share} onChangeText={(v) => { setShare(v.replace(/[^\d]/g, '').slice(0, 3)); setErrors((e) => ({ ...e, share: null })); }}
        keyboardType="number-pad" inputMode="numeric" error={errors.share}
        hint={`${owed != null ? `${otherName} owes ${money(owed)} of ${money(amountCents)}. ` : ''}Use the split in your order. Default from Settings: whoever paid covers ${me.family.default_split}%, so ${otherName}'s share is ${100 - me.family.default_split}%.`}
        testID="expense-share" />
      <ReceiptPicker value={receipt} onChange={setReceipt} disabled={saving} />
      <Checkbox label="Ask for reimbursement now" value={request} onChange={setRequest}
        hint={request ? (other ? `${other.name} will be asked to approve or dispute.` : 'Your co-parent will see the request when they join.') : 'Saved as a record only. You can request reimbursement later.'}
        testID="expense-request" />
      <Button title="Save expense" variant="primary" block onPress={save} loading={saving} style={{ marginTop: 8 }} testID="expense-save" />
      <AppText variant="footnote" tone="muted" style={{ marginTop: 10 }}>Expenses are part of the shared record and cannot be deleted.</AppText>
    </Screen>
  );
}
