import { View } from 'react-native';
import { AppText, Badge, Button, ButtonRow, Card, Row, StatusBadge, useAttempt, useDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtIso } from '@/lib/format';
import { statusTone } from '@/lib/status';
import type { CallRule } from '@/lib/types';
import { describeRule } from './format';

/**
 * A call schedule with the same actions as the web portal:
 * approve / reject (the other parent's pending request), approve ending / keep it (when the
 * other parent asked to end it), request to end (active), plus withdraw for my own pending request.
 */
export function CallRuleCard({ rule: r, myId, isParent, tz, otherName, onChanged }: {
  rule: CallRule; myId: number; isParent: boolean; tz: string; otherName: string; onChanged: () => Promise<void>;
}) {
  const dialog = useDialog();
  const attempt = useAttempt();
  const live = r.status === 'active' || r.status === 'unconfirmed';
  const awaitingMe = isParent && (r.status === 'pending' || r.status === 'unconfirmed') && r.requested_by !== myId;
  const endAsked = r.retire_requested_by != null;

  const decide = async (decision: 'approve' | 'reject') => {
    const c = await dialog.confirm({
      title: decision === 'approve' ? 'Approve call schedule' : 'Reject call schedule',
      message: r.name,
      okLabel: decision === 'approve' ? 'Approve' : 'Reject',
      destructive: decision === 'reject',
      withNote: true,
    });
    if (!c) return;
    const ok = await attempt(() => api.post(`/api/call-rules/${r.id}/decide`, { decision, note: c.note }), decision === 'approve' ? 'Approved' : 'Rejected');
    if (ok) await onChanged();
  };
  const retireDecide = async (decision: 'approve' | 'reject') => {
    const ok = await attempt(() => api.post(`/api/call-rules/${r.id}/retire-decide`, { decision }), decision === 'approve' ? 'Call schedule ended' : 'Kept');
    if (ok) await onChanged();
  };
  const requestEnd = async () => {
    const c = await dialog.confirm({ title: 'Request to end', message: r.name, okLabel: 'Request to end', withNote: true });
    if (!c) return;
    const ok = await attempt(() => api.post(`/api/call-rules/${r.id}/retire`, { note: c.note }), 'Request sent');
    if (ok) await onChanged();
  };
  const withdraw = async () => {
    const c = await dialog.confirm({ title: 'Withdraw this request?', message: r.name, okLabel: 'Withdraw', destructive: true });
    if (!c) return;
    const ok = await attempt(() => api.post(`/api/call-rules/${r.id}/withdraw`), 'Withdrawn');
    if (ok) await onChanged();
  };

  return (
    <Card tone={awaitingMe || (endAsked && r.retire_requested_by !== myId) ? 'warn' : undefined} testID={`call-rule-${r.id}`}>
      <Row align="flex-start" justify="space-between">
        <AppText variant="headline" style={{ flex: 1 }}>{r.name}</AppText>
        <StatusBadge status={r.status} />
      </Row>
      <AppText variant="subhead" tone="muted" style={{ marginTop: 4 }}>{`For ${r.entitled_name}`}</AppText>
      <AppText variant="subhead" style={{ marginTop: 2 }}>{describeRule(r)}</AppText>
      {r.reason ? <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>{`Order reference: ${r.reason}`}</AppText> : null}
      <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>{`Requested by ${r.requested_by === myId ? 'you' : r.requested_by_name} · ${fmtIso(r.requested_at, tz)}`}</AppText>
      {r.decision_note ? <AppText variant="footnote" tone="muted" style={{ marginTop: 2 }}>{`Decision note: ${r.decision_note}`}</AppText> : null}
      {endAsked ? (
        <View style={{ marginTop: 8 }}>
          <Badge label={r.retire_requested_by === myId ? `End requested: waiting for ${otherName}` : 'End requested'} tone={statusTone('pending')} />
        </View>
      ) : null}
      {isParent ? (
        <ButtonRow>
          {awaitingMe ? (
            <>
              <Button title="Approve" variant="ok" size="sm" icon="checkmark" onPress={() => decide('approve')} testID={`call-rule-${r.id}-approve`} />
              <Button title="Reject" variant="danger" size="sm" icon="close" onPress={() => decide('reject')} testID={`call-rule-${r.id}-reject`} />
            </>
          ) : null}
          {endAsked && r.retire_requested_by !== myId ? (
            <>
              <Button title="Approve ending" size="sm" onPress={() => retireDecide('approve')} testID={`call-rule-${r.id}-approve-end`} />
              <Button title="Keep it" size="sm" onPress={() => retireDecide('reject')} testID={`call-rule-${r.id}-keep`} />
            </>
          ) : null}
          {live && !endAsked ? <Button title="Request to end" size="sm" onPress={requestEnd} testID={`call-rule-${r.id}-end`} /> : null}
          {r.status === 'pending' && r.requested_by === myId ? <Button title="Withdraw" size="sm" variant="danger" onPress={withdraw} testID={`call-rule-${r.id}-withdraw`} /> : null}
        </ButtonRow>
      ) : null}
      {r.status === 'pending' && r.requested_by === myId ? <AppText variant="footnote" tone="muted" style={{ marginTop: 8 }}>{`Waiting for ${otherName} to approve.`}</AppText> : null}
    </Card>
  );
}
