import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  AppText, AsyncView, Badge, Button, ButtonRow, Callout, Card, EmptyState, Loading, NotesPanel, ParentDot, Row, Screen, Section, ShareTable,
  StatusBadge, useAttempt, useDialog,
} from '@/components/ui';
import {
  TEMPLATE_NAMES, TYPE_LABEL, holidayWhen, holidayWho, nextHolidayWindow, periodText, ruleSummary, segmentText,
} from '@/components/schedule/summary';
import { api, errorMessage } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { fmtClock, fmtDate, fmtIso, nowLocalStamp, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import type { AuditEntry, ImpactResponse, Rule } from '@/lib/types';

interface TrailStep { key: string; text: string; at: string | null; note?: string | null }

/** Decision trail from the hash-chained audit log, falling back to the rule's own fields. */
function buildTrail(rule: Rule, audit: AuditEntry[] | undefined, nameOfUser: (id: number | null) => string): TrailStep[] {
  const entries = (audit ?? []).filter((a) => a.entity === 'rule' && a.entity_id === String(rule.id)).sort((a, b) => a.seq - b.seq);
  const note = (a: AuditEntry) => (typeof a.data.note === 'string' && a.data.note ? a.data.note : null);
  if (entries.some((a) => a.action === 'request')) {
    return entries.map((a) => {
      const who = a.user_name ?? nameOfUser(a.user_id);
      const prevUnconfirmed = a.data.previous === 'unconfirmed';
      let text: string;
      switch (a.action) {
        case 'request': text = a.data.status === 'unconfirmed' ? `Added by ${who} before the co-parent joined (not yet confirmed)` : `Requested by ${who}`; break;
        case 'approve': text = `${prevUnconfirmed ? 'Confirmed' : 'Approved'} by ${who}`; break;
        case 'reject': text = `${prevUnconfirmed ? 'Disputed' : 'Rejected'} by ${who}`; break;
        case 'withdraw': text = `Withdrawn by ${who}`; break;
        case 'request_retire': text = `${who} asked to end it`; break;
        case 'approve_retire': text = `${who} agreed to end it`; break;
        case 'reject_retire': text = `${who} kept it in effect`; break;
        case 'retire': text = typeof a.data.reason === 'string' && a.data.reason ? `Ended: ${a.data.reason.toLowerCase()}` : `Ended by ${who}`; break;
        default: text = `${a.action.replace(/_/g, ' ')} by ${who}`;
      }
      return { key: String(a.seq), text, at: a.ts, note: note(a) };
    });
  }
  const steps: TrailStep[] = [{ key: 'req', text: `Requested by ${rule.requested_by_name}`, at: rule.requested_at }];
  if (rule.decided_by) steps.push({ key: 'dec', text: `${rule.status === 'rejected' ? 'Rejected' : 'Approved'} by ${rule.decided_by_name}`, at: rule.decided_at, note: rule.decision_note });
  if (rule.status === 'withdrawn') steps.push({ key: 'wd', text: 'Withdrawn', at: null });
  if (rule.status === 'retired') steps.push({ key: 'ret', text: 'Ended', at: null });
  if (rule.retire_requested_by) steps.push({ key: 'rr', text: `${nameOfUser(rule.retire_requested_by)} asked to end it`, at: rule.retire_requested_at });
  return steps;
}

/** Schedule item detail: full summary, reason, decision trail, impact on time share, actions and notes. */
export default function RuleScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const ruleId = Number(id);
  const q = useApi<Rule[]>('/api/rules');
  const rule = q.data?.find((r) => r.id === ruleId);
  return (
    <Screen headerTitle={rule?.name ?? 'Schedule item'} refreshing={q.refreshing} onRefresh={q.refresh} testID="rule-screen">
      <AsyncView state={q}>
        {() => (rule ? <RuleDetail rule={rule} reload={q.reload} /> : (
          <EmptyState icon="alert-circle-outline" title="Not found" message="This schedule item doesn't exist or belongs to another family." />
        ))}
      </AsyncView>
    </Screen>
  );
}

function RuleDetail({ rule: r, reload }: { rule: Rule; reload: () => Promise<void> }) {
  const t = useTheme();
  const dialog = useDialog();
  const attempt = useAttempt();
  const badges = useBadges();
  const { tz, myId, isParent, other, nameOf } = usePeople();
  const auditQ = useApi<AuditEntry[]>('/api/audit?limit=1000');
  const [impact, setImpact] = useState<{ loading: boolean; data?: ImpactResponse; error?: string } | null>(null);

  const pendingish = r.status === 'pending' || r.status === 'unconfirmed';
  const canDecide = isParent && pendingish && r.requested_by !== myId;
  const canWithdraw = isParent && r.status === 'pending' && r.requested_by === myId;
  const canDecideEnd = isParent && r.retire_requested_by != null && r.retire_requested_by !== myId;
  const canRequestEnd = isParent && (r.status === 'active' || r.status === 'unconfirmed') && !r.retire_requested_by && r.type !== 'default';
  const showImpactButton = pendingish || r.status === 'active';

  const after = async () => {
    setImpact(null);
    await Promise.all([reload(), auditQ.reload()]);
    void badges.refresh();
  };

  const decide = async (decision: 'approve' | 'reject') => {
    const unconfirmed = r.status === 'unconfirmed';
    const verb = decision === 'approve' ? (unconfirmed ? 'Confirm' : 'Approve') : (unconfirmed ? 'Dispute' : 'Reject');
    const c = await dialog.confirm({
      title: `${verb} "${r.name}"?`,
      message: decision === 'approve'
        ? 'Once approved it becomes part of the schedule. This is recorded with your name and the time.'
        : `${r.requested_by_name} will see that you ${unconfirmed ? 'disputed' : 'rejected'} it.`,
      okLabel: verb,
      destructive: decision === 'reject',
      withNote: true,
    });
    if (!c) return;
    const ok = await attempt(() => api.post(`/api/rules/${r.id}/decide`, { decision, note: c.note }), decision === 'approve' ? (unconfirmed ? 'Confirmed' : 'Approved') : (unconfirmed ? 'Disputed' : 'Rejected'));
    if (ok) await after();
  };

  const withdraw = async () => {
    const c = await dialog.confirm({ title: 'Withdraw this request?', message: 'It will be kept in the history as withdrawn.', okLabel: 'Withdraw', destructive: true });
    if (!c) return;
    if (await attempt(() => api.post(`/api/rules/${r.id}/withdraw`), 'Withdrawn')) await after();
  };

  const requestEnd = async () => {
    const c = await dialog.confirm({
      title: 'Request to end this item',
      message: other ? `${other.name} has to approve before it stops applying.` : 'It will stop applying now.',
      okLabel: other ? 'Request' : 'End it',
      destructive: !other,
      withNote: true,
    });
    if (!c) return;
    if (await attempt(() => api.post(`/api/rules/${r.id}/retire`, { note: c.note }), other ? 'Requested' : 'Ended')) await after();
  };

  const decideEnd = async (decision: 'approve' | 'reject') => {
    const c = await dialog.confirm(decision === 'approve'
      ? { title: 'End this item?', message: `${nameOf(r.retire_requested_by)} asked to end "${r.name}".`, okLabel: 'Approve ending', withNote: true }
      : { title: 'Keep this item?', message: 'It stays in effect.', okLabel: 'Keep it', withNote: true });
    if (!c) return;
    if (await attempt(() => api.post(`/api/rules/${r.id}/retire-decide`, { decision, note: c.note }), decision === 'approve' ? 'Ended' : 'Kept in effect')) await after();
  };

  const loadImpact = async () => {
    setImpact({ loading: true });
    try {
      setImpact({ loading: false, data: await api.get<ImpactResponse>(`/api/rules/${r.id}/impact`) });
    } catch (e) {
      setImpact({ loading: false, error: errorMessage(e) });
    }
  };

  const trail = buildTrail(r, auditQ.data, nameOf);

  return (
    <View>
      <AppText variant="title3">{r.name}</AppText>
      <Row wrap gap={6} style={{ marginTop: 6, marginBottom: t.spacing.lg }}>
        <StatusBadge status={r.status} />
        {r.retire_requested_by ? <Badge label="End requested" tone="warn" /> : null}
        <Badge label={TYPE_LABEL[r.type]} />
      </Row>

      {canDecide ? <Callout tone="warn" title={r.status === 'unconfirmed' ? 'Please confirm or dispute' : 'Waiting for your decision'}>{`${r.requested_by_name} ${r.status === 'unconfirmed' ? 'added this before you joined. It is already in effect until you confirm or dispute it.' : 'asked for this change. Nothing changes until you approve.'}`}</Callout> : null}
      {canDecideEnd ? <Callout tone="warn" title="Request to end">{`${nameOf(r.retire_requested_by)} asked to end this item. It stays in effect until you decide.`}</Callout> : null}
      {isParent && r.retire_requested_by === myId ? <Callout tone="accent">{`You asked to end this item. It stays in effect until ${other?.name ?? 'your co-parent'} decides.`}</Callout> : null}
      {canWithdraw ? <Callout tone="accent">{`Waiting for ${other?.name ?? 'your co-parent'} to approve.`}</Callout> : null}

      <Section title="Summary">
        <Card>
          <View testID="rule-summary">
            {r.type === 'default' ? <AppText>{ruleSummary(r, nameOf)}</AppText> : <RuleBreakdown rule={r} />}
          </View>
          {r.priority ? <AppText variant="footnote" tone="muted" style={{ marginTop: 8 }}>{`Priority ${r.priority} (higher wins when items in the same layer overlap)`}</AppText> : null}
        </Card>
      </Section>

      <Section title="Reason">
        <Card><AppText tone={r.reason ? 'ink' : 'muted'}>{r.reason || 'No reason given.'}</AppText></Card>
      </Section>

      <Section title="Decision trail">
        <Card testID="decision-trail">
          {auditQ.loading && !auditQ.data ? <Loading /> : trail.map((s, i) => (
            <Row key={s.key} align="flex-start" gap={10} style={{ marginTop: i ? 10 : 0 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: i === trail.length - 1 ? t.colors.accent : t.colors.line }} />
              <View style={{ flex: 1 }}>
                <AppText variant="subhead">{s.text}</AppText>
                {s.at ? <AppText variant="footnote" tone="muted">{fmtIso(s.at, tz)}</AppText> : null}
                {s.note ? <AppText variant="footnote" style={{ marginTop: 2 }}>{`“${s.note}”`}</AppText> : null}
              </View>
            </Row>
          ))}
        </Card>
      </Section>

      {canDecide || canWithdraw || canDecideEnd || canRequestEnd || showImpactButton ? (
        <Section title="Actions">
          {canDecide ? (
            <ButtonRow style={{ marginTop: 0, marginBottom: 8 }}>
              <Button title={r.status === 'unconfirmed' ? 'Confirm' : 'Approve'} variant="ok" icon="checkmark" onPress={() => decide('approve')} testID="rule-approve" />
              <Button title={r.status === 'unconfirmed' ? 'Dispute' : 'Reject'} variant="danger" icon="close" onPress={() => decide('reject')} testID="rule-reject" />
            </ButtonRow>
          ) : null}
          {canDecideEnd ? (
            <ButtonRow style={{ marginTop: 0, marginBottom: 8 }}>
              <Button title="Approve ending" variant="ok" onPress={() => decideEnd('approve')} testID="rule-approve-end" />
              <Button title="Keep it" onPress={() => decideEnd('reject')} testID="rule-keep" />
            </ButtonRow>
          ) : null}
          {showImpactButton ? <Button title="See impact on time share" icon="pie-chart-outline" onPress={loadImpact} block style={{ marginBottom: 8 }} testID="rule-impact" /> : null}
          {canWithdraw ? <Button title="Withdraw request" variant="danger" onPress={withdraw} block style={{ marginBottom: 8 }} testID="rule-withdraw" /> : null}
          {canRequestEnd ? <Button title={other ? 'Request to end' : 'End this item'} onPress={requestEnd} block testID="rule-request-end" /> : null}
        </Section>
      ) : null}

      {impact ? (
        <Section title="Impact on time share">
          <Card testID="rule-impact-result">
            {impact.loading ? <Loading label="Calculating the next 12 months…" /> : impact.error ? <AppText tone="bad">{impact.error}</AppText> : impact.data ? (
              <View>
                <AppText variant="footnote" tone="muted">{`${fmtDate(impact.data.start)} – ${fmtDate(impact.data.end)}`}</AppText>
                <AppText variant="headline" style={{ marginTop: 10 }}>Without this item</AppText>
                <ShareTable share={impact.data.before} />
                <AppText variant="headline" style={{ marginTop: 14 }}>With this item</AppText>
                <ShareTable share={impact.data.after} />
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      <NotesPanel targetType="rule" targetId={r.id} />
    </View>
  );
}

const offset = (n: number, zero: string) => (n === 0 ? zero : `${Math.abs(n)} day${Math.abs(n) > 1 ? 's' : ''} ${n < 0 ? 'before' : 'after'}`);

/** Structured details under the summary: blocks of a pattern, periods of a change, holiday dates. */
function RuleBreakdown({ rule: r }: { rule: Rule }) {
  const { tz, nameOf } = usePeople();
  const line = (key: string | number, parent: number | null, text: string) => (
    <Row key={key} gap={8} align="flex-start" style={{ marginTop: 6 }}>
      <View style={{ marginTop: 5 }}><ParentDot id={parent} /></View>
      <AppText variant="subhead" style={{ flex: 1 }}>{`${nameOf(parent)}: ${text}`}</AppText>
    </Row>
  );
  if (r.type === 'pattern') {
    const c = r.config;
    return (
      <View>
        <AppText>{`${(c.template && TEMPLATE_NAMES[c.template]) || 'Pattern'}, repeating every ${c.cycleDays} days from ${fmtDate(c.anchorDate)}:`}</AppText>
        {c.segments.map((s, i) => line(i, s.parent, segmentText(c, s)))}
        <AppText variant="footnote" tone="muted" style={{ marginTop: 8 }}>Any time not listed goes to the primary parent.</AppText>
        {c.effectiveFrom || c.effectiveTo ? <AppText variant="footnote" tone="muted">{`In effect ${c.effectiveFrom ? `from ${fmtDate(c.effectiveFrom)}` : `from ${fmtDate(c.anchorDate)}`}${c.effectiveTo ? ` until ${fmtDate(c.effectiveTo)}` : ''}`}</AppText> : null}
      </View>
    );
  }
  if (r.type === 'override') {
    return (
      <View>
        <AppText>{r.config.periods.length > 1 ? 'One-time change with a make-up / swap period:' : 'One-time change:'}</AppText>
        {r.config.periods.map((p, i) => line(i, p.parent, periodText(p)))}
      </View>
    );
  }
  if (r.type === 'holiday') {
    const c = r.config;
    const next = nextHolidayWindow(c, todayLocal(tz));
    return (
      <View>
        <AppText>{`When: ${holidayWhen(c.rule)}`}</AppText>
        <AppText variant="subhead">{`Starts ${offset(c.start.dayOffset, 'on the day')} at ${fmtClock(c.start.time)}, ends ${offset(c.end.dayOffset, 'the same day')} at ${fmtClock(c.end.time)}`}</AppText>
        <AppText variant="subhead">{`Who: ${holidayWho(c, nameOf)}`}</AppText>
        {next ? line('next', next.parent, `${next.start <= nowLocalStamp(tz) ? 'now' : 'next'}: ${periodText(next)}`) : null}
      </View>
    );
  }
  return null;
}
