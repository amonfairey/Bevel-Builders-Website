import { useState } from 'react';
import { View } from 'react-native';
import {
  AppText, AsyncView, AttachmentLink, Button, Callout, Card, DateField, Row, Screen, Section, TextArea, useAttempt, useToast,
} from '@/components/ui';
import { AuditLog } from '@/components/records/AuditLog';
import { openReport } from '@/components/records/openReport';
import { BREAK_ANYWHERE, copyText, MONO, shareText } from '@/components/settings/share';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, fmtIso, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import type { IdResponse, Note, Verify } from '@/lib/types';

const NOTE_TARGET: Record<string, string> = {
  general: 'Journal', event: 'Activity', expense: 'Expense', rule: 'Schedule item', call: 'Call', exchange: 'Exchange',
  payment: 'Payment', call_rule: 'Call schedule', day: 'Day',
};
const noteTarget = (n: Note) =>
  n.target_type === 'day' ? `Day ${fmtDate(n.target_id)}` : `${NOTE_TARGET[n.target_type] ?? n.target_type}${n.target_id ? ` #${n.target_id}` : ''}`;

/**
 * Records & reports (web portal VIEWS.records): the printable court/attorney report, the
 * hash-chain integrity check and its fingerprint, the journal, recent notes and the activity log.
 */
export default function RecordsScreen() {
  const t = useTheme();
  const toast = useToast();
  const attempt = useAttempt();
  const { me, tz, isParent } = usePeople();
  const today = todayLocal(tz);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [journal, setJournal] = useState('');
  const [journalError, setJournalError] = useState<string | null>(null);
  const [notesShown, setNotesShown] = useState(20);
  const [logKey, setLogKey] = useState(0);
  const verify = useApi<Verify>('/api/audit/verify');
  const notes = useApi<Note[]>('/api/notes');

  const open = async () => {
    setRangeError(null);
    if (!from || !to) { setRangeError('Choose both dates'); return; }
    if (to < from) { setRangeError('The end date is before the start date'); return; }
    try { await openReport(from, to); } catch (e) { toast.show(errorMessage(e), { tone: 'bad' }); }
  };

  const saveJournal = async () => {
    if (!journal.trim()) { setJournalError('Write something first'); return; }
    const r = await attempt(() => api.post<IdResponse>('/api/notes', { target_type: 'general', target_id: '', body: journal }), 'Saved to your journal');
    if (r) { setJournal(''); setLogKey((k) => k + 1); await Promise.all([notes.reload(), verify.reload()]); }
  };

  const refresh = () => { setLogKey((k) => k + 1); void verify.refresh(); void notes.refresh(); };

  return (
    <Screen headerTitle="Records & reports" refreshing={verify.refreshing || notes.refreshing} onRefresh={refresh} testID="records-screen">
      <AppText variant="subhead" tone="muted" style={{ marginBottom: 16 }}>Everything here is append-only and timestamped by the server.</AppText>

      <Section title="Court / attorney report">
        <Card>
          <AppText variant="subhead" tone="muted" style={{ marginBottom: 12 }}>
            A printable report: time share, schedule approvals, exchanges, calls, expenses, messages, notes and the integrity check. It opens in Safari; use Share → Print (or Save to Files) to keep a PDF.
          </AppText>
          <Row gap={12} align="flex-start">
            <View style={{ flex: 1 }}><DateField label="From" value={from} onChange={setFrom} max={to || undefined} testID="report-from" /></View>
            <View style={{ flex: 1 }}><DateField label="To" value={to} onChange={setTo} min={from || undefined} testID="report-to" /></View>
          </Row>
          {rangeError ? <Callout tone="bad">{rangeError}</Callout> : null}
          <Button title="Open report" icon="document-text-outline" variant="primary" block onPress={open} testID="open-report" />
          <AppText variant="footnote" tone="muted" style={{ marginTop: 8 }}>The report link works for 15 minutes and only for you.</AppText>
        </Card>
      </Section>

      <Section title="Integrity check">
        <AsyncView state={verify}>
          {(v) => (
            <Card tone={v.ok ? 'ok' : 'bad'} testID="integrity">
              <AppText variant="title" tone={v.ok ? 'ok' : 'bad'} testID="integrity-result">{v.ok ? 'Passed' : 'FAILED'}</AppText>
              <AppText variant="subhead" style={{ marginTop: 2 }}>{`${v.entries} ${v.entries === 1 ? 'entry' : 'entries'} in the hash chain.`}</AppText>
              {v.problems.map((p, i) => <AppText key={i} variant="subhead" tone="bad" style={{ marginTop: 4 }}>{p}</AppText>)}
              <AppText variant="footnote" tone="muted" style={{ marginTop: 12, marginBottom: 4 }}>Current fingerprint (chain head):</AppText>
              <View style={{ backgroundColor: t.colors.soft, borderRadius: 8, padding: 10 }}>
                <AppText selectable variant="footnote" style={[{ fontFamily: MONO }, BREAK_ANYWHERE]} testID="integrity-head">{v.head}</AppText>
              </View>
              <Row gap={8} wrap style={{ marginTop: 10 }}>
                <Button title="Copy" icon="copy-outline" size="sm" onPress={() => copyText(v.head, toast, 'Fingerprint copied')} testID="integrity-copy" />
                <Button
                  title="Share"
                  icon="share-outline"
                  size="sm"
                  onPress={() => shareText(`CoParent Hub records fingerprint for ${me.family.name}, ${fmtIso(new Date().toISOString(), tz)} (${v.entries} entries):\n${v.head}`, toast, 'Records fingerprint')}
                  testID="integrity-share"
                />
              </Row>
              <AppText variant="footnote" tone="muted" style={{ marginTop: 10 }}>
                Tip: email this fingerprint to yourself or your attorney now and then. It proves the records up to that point have not been changed since, even by whoever runs the server.
              </AppText>
            </Card>
          )}
        </AsyncView>
      </Section>

      {isParent ? (
        <Section title="Journal">
          <TextArea
            value={journal}
            onChangeText={(v) => { setJournal(v); if (journalError) setJournalError(null); }}
            placeholder="Something you want on the record that is not tied to a specific item. Facts, dates, names."
            hint="Journal entries are permanent and visible to the other parent and view-only members."
            error={journalError}
            accessibilityLabel="Journal entry"
            testID="journal-text"
          />
          <Button title="Save entry" variant="primary" onPress={saveJournal} testID="journal-save" />
        </Section>
      ) : null}

      <Section title="Recent notes">
        <AsyncView state={notes}>
          {(list) => list.length === 0 ? <AppText tone="muted">No notes yet.</AppText> : (
            <View testID="recent-notes">
              {list.slice(0, notesShown).map((n) => (
                <View key={n.id} style={{ borderLeftWidth: 3, borderLeftColor: n.target_type === 'general' ? t.colors.accent : t.colors.line, paddingLeft: 10, paddingVertical: 4, marginBottom: 12 }}>
                  <AppText>{n.body}</AppText>
                  {n.attachment_hash ? <AttachmentLink hash={n.attachment_hash} name={n.attachment_name} type={n.attachment_type} /> : null}
                  <AppText variant="footnote" tone="muted" style={{ marginTop: 2 }}>{`${n.author_name} · ${fmtIso(n.created_at, tz)} · ${noteTarget(n)}`}</AppText>
                </View>
              ))}
              {list.length > notesShown ? <Button title="Show more notes" size="sm" onPress={() => setNotesShown((s) => s + 20)} style={{ alignSelf: 'center' }} /> : null}
            </View>
          )}
        </AsyncView>
      </Section>

      <AuditLog tz={tz} refreshKey={logKey} />
    </Screen>
  );
}
