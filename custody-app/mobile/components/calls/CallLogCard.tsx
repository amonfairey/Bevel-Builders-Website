import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Badge, Button, ButtonRow, Card, NotesPanel, Row, useAttempt, useDialog, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtStamp } from '@/lib/format';
import type { Tone } from '@/lib/theme';
import type { Call, CallStatus } from '@/lib/types';
import { callStatusLabel } from './format';

const STATUS_TONE: Record<CallStatus, Tone> = {
  completed: 'ok',
  short: 'warn',
  missed_not_facilitated: 'bad',
  missed_not_called: 'bad',
  declined_by_child: 'warn',
  rescheduled: 'neutral',
  cancelled: 'neutral',
};

/**
 * One call log entry: what happened, when, who logged it and whether the other parent agrees.
 * The parent who did not log it can Agree or Dispute (a dispute needs a note, saved as a
 * note on the call like the web portal). Notes open inline.
 */
export function CallLogCard({ call: c, myId, isParent, ruleName, childNames, nameOf, onChanged }: {
  call: Call;
  myId: number;
  isParent: boolean;
  ruleName: string | null;
  childNames: string;
  nameOf: (id: number | null | undefined) => string;
  onChanged: () => Promise<void>;
}) {
  const dialog = useDialog();
  const attempt = useAttempt();
  const toast = useToast();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesKey, setNotesKey] = useState(0);
  const canAnswer = isParent && !c.confirm_result && c.logged_by !== myId;

  const agree = async () => {
    const ok = await attempt(() => api.post(`/api/calls/${c.id}/confirm`, { agree: true }), 'Confirmed');
    if (ok) await onChanged();
  };
  const dispute = async () => {
    const r = await dialog.confirm({
      title: 'Dispute this log',
      message: 'Say what actually happened. Your note is saved to the record.',
      withNote: true,
      noteRequired: true,
      okLabel: 'Dispute',
      destructive: true,
    });
    if (!r) return;
    const ok = await attempt(() => api.post(`/api/calls/${c.id}/confirm`, { agree: false, note: r.note }));
    if (!ok) return;
    try {
      await api.post('/api/notes', { target_type: 'call', target_id: String(c.id), body: r.note });
      toast.show('Disputed. Your note was saved.', { tone: 'ok' });
    } catch (e) {
      toast.show(`Disputed, but the note was not saved: ${errorMessage(e)}`, { tone: 'bad' });
    }
    setNotesKey((k) => k + 1);
    setNotesOpen(true);
    await onChanged();
  };

  const confirmation = c.confirm_result === 'agreed'
    ? { label: `${nameOf(c.confirmed_by)} agreed`, tone: 'ok' as Tone }
    : c.confirm_result === 'disputed'
      ? { label: `${nameOf(c.confirmed_by)} disputed`, tone: 'bad' as Tone }
      : { label: c.logged_by === myId ? 'Not yet confirmed by the other parent' : 'Waiting for your answer', tone: 'warn' as Tone };

  return (
    <Card tone={canAnswer ? 'warn' : undefined} testID={`call-${c.id}`}>
      <Row align="flex-start" justify="space-between" wrap>
        <Badge label={callStatusLabel(c.status)} tone={STATUS_TONE[c.status] ?? 'neutral'} />
        <AppText variant="footnote" tone="muted">{fmtStamp(c.started_local)}</AppText>
      </Row>
      <AppText variant="subhead" style={{ marginTop: 6 }}>
        {[c.method === 'video' ? 'Video' : 'Phone', c.duration_min ? `${c.duration_min} min` : null, ruleName ?? 'Not under a schedule'].filter(Boolean).join(' · ')}
      </AppText>
      {childNames ? <AppText variant="footnote" tone="muted" style={{ marginTop: 2 }}>{`Children: ${childNames}`}</AppText> : null}
      {c.details ? <AppText variant="subhead" style={{ marginTop: 6 }} selectable>{c.details}</AppText> : null}
      <AppText variant="footnote" tone="muted" style={{ marginTop: 6 }}>{`Logged by ${c.logged_by === myId ? 'you' : c.logged_by_name}`}</AppText>
      <View style={{ marginTop: 6 }}>
        <Badge label={confirmation.label} tone={confirmation.tone} />
      </View>
      <ButtonRow>
        {canAnswer ? (
          <>
            <Button title="Agree" variant="ok" size="sm" icon="checkmark" onPress={agree} testID={`call-${c.id}-agree`} />
            <Button title="Dispute" variant="danger" size="sm" icon="alert-circle-outline" onPress={dispute} testID={`call-${c.id}-dispute`} />
          </>
        ) : null}
        <Button title={notesOpen ? 'Hide notes' : 'Notes'} size="sm" icon="document-text-outline" onPress={() => setNotesOpen((o) => !o)} testID={`call-${c.id}-notes`} />
      </ButtonRow>
      {notesOpen ? (
        <View style={{ marginTop: 12 }}>
          <NotesPanel key={notesKey} targetType="call" targetId={c.id} title="Call notes" />
        </View>
      ) : null}
    </Card>
  );
}
