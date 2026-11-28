import { useEffect, useRef, useState } from 'react';
import { router, type Href } from 'expo-router';
import {
  AppText, Button, Checkbox, Chips, DateField, EmptyState, ErrorView, Field, FieldShell, HeaderButton, Loading, Screen, Section, TextArea, useAttempt,
} from '@/components/ui';
import { PAYMENT_METHODS, parseDollars } from '@/components/money/constants';
import { api } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { fmtShortDate, isDate, money, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { Expense, IdResponse } from '@/lib/types';

/**
 * Record a payment I sent to the co-parent (iOS sheet). Approved expenses I owe are listed
 * pre-checked and the amount follows the checked total; the recipient confirms receipt.
 */
export default function NewPaymentScreen() {
  const { tz, myId, other, isParent } = usePeople();
  const attempt = useAttempt();
  const badges = useBadges();
  const q = useApi<Expense[]>(isParent && other ? '/api/expenses' : null);
  const owed = (q.data ?? []).filter((e) => e.status === 'approved' && e.paid_by !== myId);

  const [checked, setChecked] = useState<number[] | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayLocal(tz));
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  // Pre-check every approved expense once the list arrives, and fill in the total.
  useEffect(() => {
    if (q.data === undefined || checked !== null) return;
    const ids = owed.map((e) => e.id);
    setChecked(ids);
    const total = owed.reduce((s, e) => s + e.owed_cents, 0);
    if (total) setAmount((total / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const sel = checked ?? [];
  const toggle = (id: number, on: boolean) => {
    const next = on ? [...sel, id] : sel.filter((x) => x !== id);
    setChecked(next);
    const total = owed.filter((e) => next.includes(e.id)).reduce((s, e) => s + e.owed_cents, 0);
    setAmount(total ? (total / 100).toFixed(2) : '');
    setErrors((e) => ({ ...e, amount: null }));
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace(routes.money as Href));

  const save = async () => {
    if (busy.current) return;
    const dollars = parseDollars(amount);
    const errs: Record<string, string | null> = {};
    if (!dollars) errs.amount = 'Enter an amount greater than zero';
    if (!isDate(date)) errs.date = 'Choose a date';
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    busy.current = true;
    setSaving(true);
    try {
      const r = await attempt(() => api.post<IdResponse>('/api/payments', { amount: dollars, date, method: method.trim(), note: note.trim(), expense_ids: sel }),
        `Recorded. ${other?.name ?? 'Your co-parent'} will be asked to confirm.`);
      if (r) { void badges.refresh(); close(); }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  if (!isParent || !other) {
    return (
      <Screen headerTitle="Record a payment">
        <EmptyState icon="cash-outline" title={!isParent ? 'View-only access' : 'Your co-parent has not joined yet'}
          message={!isParent ? 'Only the two parents can record payments.' : 'Payments go to your co-parent, who confirms they received them. Invite them from Settings.'} />
      </Screen>
    );
  }
  if (q.data === undefined) {
    return <Screen headerTitle="Record a payment">{q.error ? <ErrorView message={q.error.message} onRetry={q.reload} /> : <Loading />}</Screen>;
  }

  const methodLower = method.trim().toLowerCase();
  return (
    <Screen headerTitle="Record a payment" headerRight={() => <HeaderButton title="Save" bold onPress={save} disabled={saving} testID="payment-save-header" />} testID="payment-new">
      <AppText tone="muted" style={{ marginBottom: 16 }}>{`Record money you sent to ${other.name}. They confirm when they receive it; until then it doesn't change the balance.`}</AppText>
      {owed.length ? (
        <Section title="Covers these approved expenses">
          {owed.map((e) => (
            <Checkbox key={e.id} label={`${e.description} (${money(e.owed_cents)})`} hint={`${fmtShortDate(e.date)} · total ${money(e.amount_cents)}`}
              value={sel.includes(e.id)} onChange={(on) => toggle(e.id, on)} testID={`payment-exp-${e.id}`} />
          ))}
        </Section>
      ) : <AppText variant="subhead" tone="muted" style={{ marginBottom: 16 }}>{`No approved expenses to pay ${other.name} back for. You can still record a payment.`}</AppText>}
      <Field label="Amount ($)" value={amount} onChangeText={(v) => { setAmount(v); setErrors((e) => ({ ...e, amount: null })); }} keyboardType="decimal-pad" inputMode="decimal"
        placeholder="0.00" error={errors.amount} testID="payment-amount" />
      <DateField label="Date sent" value={date} onChange={setDate} error={errors.date} max={todayLocal(tz)} testID="payment-date" />
      <FieldShell label="Method">
        <Chips options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} values={PAYMENT_METHODS.filter((m) => m.toLowerCase() === methodLower)} multiple={false}
          onChange={(v) => setMethod(v[0] ?? '')} />
      </FieldShell>
      <Field value={method} onChangeText={setMethod} placeholder="Zelle, Venmo, check #…" maxLength={60} accessibilityLabel="Method" style={{ marginTop: -8 }} testID="payment-method" />
      <TextArea label="Note (optional)" value={note} onChangeText={setNote} placeholder="Reference number, what it covers…" maxLength={1000} testID="payment-note" />
      <Button title="Record payment" variant="primary" block onPress={save} loading={saving} testID="payment-save" />
    </Screen>
  );
}
