import { useCallback, useState } from 'react';
import { router, type Href } from 'expo-router';
import { AppText, Button, ButtonRow, Callout, ErrorView, Loading, Screen, Section } from '@/components/ui';
import { CallLogCard } from '@/components/calls/CallLogCard';
import { CallRuleCard } from '@/components/calls/CallRuleCard';
import { ComplianceCard } from '@/components/calls/ComplianceCard';
import { qs } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { addDays, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { Call, CallRule, Compliance } from '@/lib/types';

const PAGE = 25;

/**
 * Phone & video calls: last-4-weeks compliance per call schedule, the call schedules with
 * their approval actions, and the call log with agree / dispute and notes. Viewers read only.
 */
export default function CallsScreen() {
  const { myId, tz, isParent, other, nameOf, childNames } = usePeople();
  const badges = useBadges();
  const today = todayLocal(tz);
  const rulesQ = useApi<CallRule[]>('/api/call-rules');
  const callsQ = useApi<Call[]>('/api/calls');
  const compQ = useApi<Compliance[]>(`/api/calls/compliance${qs({ start: addDays(today, -27), end: addDays(today, 1) })}`);
  const [shown, setShown] = useState(PAGE);
  const [refreshing, setRefreshing] = useState(false);

  const { reload: reloadRules } = rulesQ;
  const { reload: reloadCalls } = callsQ;
  const { reload: reloadComp } = compQ;
  const refreshBadges = badges.refresh;
  const reloadAll = useCallback(async () => {
    await Promise.all([reloadRules(), reloadCalls(), reloadComp()]);
    void refreshBadges();
  }, [reloadRules, reloadCalls, reloadComp, refreshBadges]);
  const onRefresh = async () => {
    setRefreshing(true);
    try { await reloadAll(); } finally { setRefreshing(false); }
  };

  const firstError = rulesQ.error ?? callsQ.error ?? compQ.error;
  const ready = rulesQ.data && callsQ.data && compQ.data;
  const otherName = other?.name ?? 'the other parent';

  const actions = isParent ? (
    <ButtonRow style={{ marginTop: 0, marginBottom: 20 }}>
      <Button title="Log a call" icon="call-outline" variant="primary" onPress={() => router.push(routes.logCall as Href)} testID="log-call" />
      <Button title="Call schedule" icon="add" onPress={() => router.push(routes.callRule as Href)} testID="new-call-rule" />
    </ButtonRow>
  ) : (
    <Callout tone="neutral">View only: you can see call schedules, the call log and compliance, but not change them.</Callout>
  );

  let body;
  if (!ready) {
    body = firstError && !(rulesQ.data || callsQ.data || compQ.data)
      ? <ErrorView message={firstError.message} onRetry={reloadAll} />
      : <Loading />;
  } else {
    const rules = rulesQ.data!;
    const calls = callsQ.data!;
    const comp = compQ.data!;
    const ruleName = (id: number | null) => (id == null ? null : rules.find((r) => r.id === id)?.name ?? 'Call schedule');
    const visibleRules = rules.filter((r) => !['rejected', 'withdrawn', 'retired'].includes(r.status));
    body = (
      <>
        <Section title="Last 4 weeks">
          {comp.length ? comp.map((c) => <ComplianceCard key={c.rule.id} c={c} />) : (
            <AppText tone="muted" style={{ marginHorizontal: 4 }}>
              {rules.some((r) => r.status === 'pending') ? 'Compliance appears once a call schedule is approved.' : 'Add a call schedule to track compliance.'}
            </AppText>
          )}
        </Section>

        <Section title="Call schedules">
          {visibleRules.length ? visibleRules.map((r) => (
            <CallRuleCard key={r.id} rule={r} myId={myId} isParent={isParent} tz={tz} otherName={otherName} onChanged={reloadAll} />
          )) : <AppText tone="muted" style={{ marginHorizontal: 4 }}>None.</AppText>}
        </Section>

        <Section title="Call log" footer={calls.length ? 'Each log is permanent. The parent who did not log a call can agree or dispute it once.' : undefined}>
          {calls.length ? (
            <>
              {calls.slice(0, shown).map((c) => (
                <CallLogCard
                  key={c.id}
                  call={c}
                  myId={myId}
                  isParent={isParent}
                  ruleName={ruleName(c.rule_id)}
                  childNames={childNames(c.child_ids)}
                  nameOf={nameOf}
                  onChanged={reloadAll}
                />
              ))}
              {calls.length > shown ? <Button title={`Show more (${calls.length - shown})`} block onPress={() => setShown((n) => n + PAGE)} /> : null}
            </>
          ) : <AppText tone="muted" style={{ marginHorizontal: 4 }}>No calls logged.</AppText>}
        </Section>
      </>
    );
  }

  return (
    <Screen headerTitle="Calls & video" refreshing={refreshing} onRefresh={onRefresh} testID="calls-screen">
      <AppText variant="subhead" tone="muted" style={{ marginBottom: 12 }}>
        Track court-ordered contact: what was allowed, what happened, and whether the other parent agrees.
      </AppText>
      {actions}
      {body}
    </Screen>
  );
}
