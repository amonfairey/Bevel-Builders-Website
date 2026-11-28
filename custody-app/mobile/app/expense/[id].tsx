import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import {
  AppText, AttachmentLink, Badge, Button, ButtonRow, Callout, Card, EmptyState, ErrorView, Loading, NotesPanel, Screen, Section, StatusBadge,
} from '@/components/ui';
import { categoryLabel } from '@/components/money/constants';
import { shareOwnerLabel } from '@/components/money/ExpenseCard';
import { useMoneyActions } from '@/components/money/useMoneyActions';
import { fmtDate, fmtIso, money } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useTheme } from '@/lib/theme';
import type { Expense } from '@/lib/types';

function InfoRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.info, { borderBottomColor: t.colors.line }]} testID={testID}>
      <AppText variant="subhead" tone="muted" style={styles.infoLabel}>{label}</AppText>
      <AppText variant="subhead" style={{ flex: 1 }}>{value}</AppText>
    </View>
  );
}

/** One expense: every field, the receipt, the decision, approve / dispute / request, and notes. */
export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { me, myId, tz, other, isParent, nameOf, childNames } = usePeople();
  const q = useApi<Expense[]>('/api/expenses');
  const actions = useMoneyActions(q.reload);

  if (q.data === undefined) {
    return <Screen headerTitle="Expense">{q.error ? <ErrorView message={q.error.message} onRetry={q.reload} /> : <Loading />}</Screen>;
  }
  const e = q.data.find((x) => String(x.id) === String(id));
  if (!e) {
    return (
      <Screen headerTitle="Expense">
        <EmptyState icon="receipt-outline" title="Expense not found" message="It may belong to another family, or the link is wrong." actionLabel="Go to Money" onAction={() => router.navigate(routes.money as Href)} />
      </Screen>
    );
  }

  const mine = e.paid_by === myId;
  const canDecide = isParent && !mine && (e.status === 'requested' || e.status === 'disputed');
  const canRequest = isParent && mine && e.status === 'logged' && !!other;

  return (
    <Screen headerTitle="Expense" refreshing={q.refreshing} onRefresh={q.refresh} testID="expense-detail">
      <Card>
        <AppText variant="title3" testID="expense-title">{e.description}</AppText>
        <AppText variant="title" style={{ marginTop: 4 }}>{money(e.amount_cents)}</AppText>
        <View style={{ marginTop: 8 }}><StatusBadge status={e.status} /></View>
      </Card>

      {e.status === 'requested' && mine ? <Callout tone="warn">{`Waiting for ${other?.name ?? 'your co-parent'} to approve or dispute.`}</Callout> : null}
      {e.status === 'requested' && canDecide ? <Callout tone="warn">{`${nameOf(e.paid_by)} is asking you to pay ${money(e.owed_cents)}.`}</Callout> : null}
      {e.status === 'disputed' ? <Callout tone="bad" title="Disputed">{e.decision_note ? `"${e.decision_note}"` : 'No reason given.'}</Callout> : null}
      {e.status === 'logged' ? <Callout tone="neutral">Record only: nobody has been asked to pay for this.</Callout> : null}

      <Section title="Details">
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          <InfoRow label="Date" value={fmtDate(e.date)} />
          <InfoRow label="Category" value={categoryLabel(e.category)} />
          <InfoRow label="For" value={childNames(e.child_ids) || 'Not specified'} />
          <InfoRow label="Paid by" value={mine ? `${nameOf(e.paid_by)} (you)` : nameOf(e.paid_by)} />
          <InfoRow label={shareOwnerLabel(me, e)} value={`${e.other_share_pct}% = ${money(e.owed_cents)}`} testID="expense-share" />
          <InfoRow label="Logged" value={fmtIso(e.created_at, tz)} />
          {e.decided_at ? <InfoRow label={e.status === 'disputed' ? 'Disputed' : 'Decided'} value={`${nameOf(e.decided_by)} · ${fmtIso(e.decided_at, tz)}`} /> : null}
          {e.decision_note && e.status !== 'disputed' ? <InfoRow label="Decision note" value={`"${e.decision_note}"`} /> : null}
        </Card>
        {e.event_id ? <Button title="Open the linked activity" variant="link" icon="football-outline" onPress={() => router.push(routes.activity(e.event_id as number) as Href)} /> : null}
      </Section>

      <Section title="Receipt">
        {e.receipt_hash ? (
          <Card>
            <AttachmentLink hash={e.receipt_hash} name={e.receipt_name} type={e.receipt_type} label={`${e.receipt_type === 'application/pdf' ? 'Open receipt (PDF)' : 'View receipt'}: ${e.receipt_name || 'file'}`} />
            <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>{`SHA-256 ${e.receipt_hash.slice(0, 16)}…`}</AppText>
          </Card>
        ) : <Badge label="No receipt" />}
      </Section>

      {canDecide || canRequest ? (
        <Section title="Actions">
          <ButtonRow style={{ marginTop: 0 }}>
            {canDecide ? <Button title="Approve" variant="ok" icon="checkmark" onPress={() => actions.approve(e)} testID="expense-approve" /> : null}
            {canDecide && e.status !== 'disputed' ? <Button title="Dispute" variant="danger" onPress={() => actions.dispute(e)} testID="expense-dispute" /> : null}
            {canRequest ? <Button title="Request reimbursement" variant="primary" onPress={() => actions.request(e, other?.name ?? 'Your co-parent')} testID="expense-request" /> : null}
          </ButtonRow>
          {canDecide && e.status === 'disputed' ? <AppText variant="footnote" tone="muted" style={{ marginTop: 6 }}>You disputed this. Approve it if you have since agreed.</AppText> : null}
        </Section>
      ) : null}

      <NotesPanel targetType="expense" targetId={e.id} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel: { width: 120, paddingRight: 8 },
});
