import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import {
  AppText, Button, ButtonRow, Card, EmptyState, ErrorView, Loading, Screen, Section, StatusBadge,
} from '@/components/ui';
import { ExpenseCard } from '@/components/money/ExpenseCard';
import { useMoneyActions } from '@/components/money/useMoneyActions';
import { fmtShortDate, money } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useTheme } from '@/lib/theme';
import type { Balance, Expense, Payment } from '@/lib/types';

/**
 * Money tab: approved balance, amounts awaiting approval, payments to confirm, expenses
 * waiting for my approval, every expense and every payment (web portal VIEWS.expenses).
 */
export default function MoneyScreen() {
  const { me, myId, other, isParent, nameOf } = usePeople();
  const t = useTheme();
  const exps = useApi<Expense[]>('/api/expenses');
  const pays = useApi<Payment[]>('/api/payments');
  const bal = useApi<Balance>(isParent ? '/api/balance' : null);

  const reloadAll = useCallback(async () => { await Promise.all([exps.reload(), pays.reload(), isParent ? bal.reload() : Promise.resolve()]); }, [exps, pays, bal, isParent]);
  const refreshAll = useCallback(() => { void Promise.all([exps.refresh(), pays.refresh(), isParent ? bal.refresh() : Promise.resolve()]); }, [exps, pays, bal, isParent]);
  const actions = useMoneyActions(reloadAll);

  const error = exps.error || pays.error || (isParent ? bal.error : null);
  const ready = exps.data !== undefined && pays.data !== undefined && (!isParent || bal.data !== undefined);
  const go = (href: string) => router.push(href as Href);

  let body;
  if (!ready) {
    body = error ? <ErrorView message={error.message} onRetry={reloadAll} /> : <Loading />;
  } else {
    const expenses = exps.data ?? [];
    const payments = pays.data ?? [];
    const b = bal.data;
    const needMe = isParent ? expenses.filter((e) => e.status === 'requested' && e.paid_by !== myId) : [];
    const payToConfirm = isParent ? payments.filter((p) => p.status === 'sent' && p.to_user === myId) : [];
    const coName = other?.name ?? 'Your co-parent';

    body = (
      <>
        {isParent ? (
          <ButtonRow style={{ marginTop: 0, marginBottom: t.spacing.lg }}>
            <Button title="Add expense" icon="add" variant="primary" onPress={() => go(routes.newExpense())} testID="money-add-expense" />
            {other ? <Button title="Record a payment I sent" icon="cash-outline" onPress={() => go(routes.newPayment)} testID="money-record-payment" /> : null}
          </ButtonRow>
        ) : null}

        {b ? (
          <View style={styles.grid}>
            <Card style={styles.cell} testID="money-balance">
              <AppText variant="footnote" tone="muted">Approved balance</AppText>
              <AppText variant="title3" style={{ marginTop: 4 }} tone={b.net_cents < 0 ? 'bad' : b.net_cents > 0 ? 'ok' : 'ink'} testID="money-balance-text">
                {b.net_cents === 0 ? 'Even' : b.net_cents > 0 ? `${coName} owes you ${money(b.net_cents)}` : `You owe ${money(-b.net_cents)}`}
              </AppText>
            </Card>
            <Card style={styles.cell} testID="money-pending">
              <AppText variant="footnote" tone="muted">Awaiting approval</AppText>
              <AppText variant="subhead" style={{ marginTop: 4 }}>{`To you: ${money(b.pending_to_me)}`}</AppText>
              <AppText variant="subhead">{`From you: ${money(b.pending_from_me)}`}</AppText>
              {b.disputed_cents ? <AppText variant="subhead" tone="bad">{`Disputed: ${money(b.disputed_cents)}`}</AppText> : null}
            </Card>
          </View>
        ) : null}
        {!isParent ? <AppText tone="muted" style={{ marginBottom: t.spacing.lg }}>View-only: you can see expenses and payments but not approve or record them.</AppText> : null}

        {payToConfirm.length ? (
          <Section title="Did you receive these payments?">
            {payToConfirm.map((p) => (
              <Card key={p.id} tone="warn" testID={`confirm-payment-${p.id}`}>
                <View style={styles.head}>
                  <AppText weight="600" style={{ flex: 1 }}>{`${money(p.amount_cents)} from ${nameOf(p.from_user)}`}</AppText>
                </View>
                <AppText variant="footnote" tone="muted">{`${fmtShortDate(p.date)} · ${p.method || 'method not given'}`}</AppText>
                {p.note ? <AppText variant="subhead" style={{ marginTop: 4 }}>{p.note}</AppText> : null}
                <ButtonRow>
                  <Button title="Yes, received" variant="ok" size="sm" icon="checkmark" onPress={() => actions.confirmReceived(p, nameOf(p.from_user))} testID={`payment-received-${p.id}`} />
                  <Button title="Not received" variant="danger" size="sm" onPress={() => actions.notReceived(p)} testID={`payment-not-received-${p.id}`} />
                </ButtonRow>
              </Card>
            ))}
          </Section>
        ) : null}

        {needMe.length ? (
          <Section title="Waiting for your approval">
            {needMe.map((e) => (
              <ExpenseCard key={e.id} me={me} e={e} tone="warn" onPress={() => go(routes.expense(e.id))}>
                <ButtonRow>
                  <Button title="Approve" variant="ok" size="sm" icon="checkmark" onPress={() => actions.approve(e)} testID={`expense-approve-${e.id}`} />
                  <Button title="Dispute" variant="danger" size="sm" onPress={() => actions.dispute(e)} testID={`expense-dispute-${e.id}`} />
                </ButtonRow>
              </ExpenseCard>
            ))}
          </Section>
        ) : null}

        <Section title="All expenses">
          {expenses.length ? expenses.map((e) => <ExpenseCard key={e.id} me={me} e={e} onPress={() => go(routes.expense(e.id))} />) : (
            <EmptyState icon="receipt-outline" title="No expenses yet" message="Log shared costs with a receipt photo. The other parent approves or disputes; payments are confirmed by whoever receives them." />
          )}
        </Section>

        <Section title="Payments">
          {payments.length ? payments.map((p) => (
            <Card key={p.id} testID={`payment-${p.id}`}>
              <View style={styles.head}>
                <AppText weight="600" style={{ flex: 1 }} numberOfLines={1}>{`${p.from_user === myId ? 'You' : nameOf(p.from_user)} → ${p.to_user === myId ? 'you' : nameOf(p.to_user)}`}</AppText>
                <AppText weight="700" style={{ marginLeft: 8 }}>{money(p.amount_cents)}</AppText>
              </View>
              <View style={[styles.head, { marginTop: 6, alignItems: 'center' }]}>
                <StatusBadge status={p.status} />
                <AppText variant="footnote" tone="muted" style={{ marginLeft: 8, flex: 1 }} numberOfLines={1}>{[fmtShortDate(p.date), p.method || null].filter(Boolean).join(' · ')}</AppText>
              </View>
              {p.note ? <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>{p.note}</AppText> : null}
              {p.expense_ids.length ? <AppText variant="footnote" tone="muted">{`Covers ${p.expense_ids.length} expense${p.expense_ids.length === 1 ? '' : 's'}`}</AppText> : null}
            </Card>
          )) : <AppText tone="muted">No payments recorded.</AppText>}
        </Section>
      </>
    );
  }

  return (
    <Screen title="Money" subtitle="Shared expenses, reimbursement and payments" refreshing={exps.refreshing || pays.refreshing || bal.refreshing} onRefresh={refreshAll} testID="money-screen">
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  cell: { flexGrow: 1, flexBasis: 150, marginBottom: 0 },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
});
