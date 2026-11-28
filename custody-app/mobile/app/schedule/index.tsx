import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AppText, AsyncView, Button, ButtonRow, Callout, Card, DateField, IconButton, Loading, Row, Screen, Section, ShareTable, useDialog,
} from '@/components/ui';
import { RuleRow } from '@/components/schedule/RuleRow';
import { HISTORY, IN_EFFECT, RULE_GROUPS } from '@/components/schedule/summary';
import { qs } from '@/lib/api';
import { diffDays, fmtDate, isDate, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useTheme } from '@/lib/theme';
import type { Rule, TimelineResponse } from '@/lib/types';

const go = (href: string) => router.push(href as Href);

/**
 * Custody schedule: decisions waiting on me, my open requests, time share for a date range,
 * the rules in effect by layer, and the history. Tap an item for details and actions.
 */
export default function ScheduleScreen() {
  const t = useTheme();
  const dialog = useDialog();
  const { tz, myId, isParent, other } = usePeople();
  const rulesQ = useApi<Rule[]>('/api/rules');

  const year = Number(todayLocal(tz).slice(0, 4));
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year + 1}-01-01`);
  const rangeError = !isDate(from) || !isDate(to) ? 'Choose both dates'
    : to <= from ? 'The end date must be after the start date'
      : diffDays(to, from) > 800 ? 'Choose at most 800 days' : null;
  const shareQ = useApi<TimelineResponse>(rangeError ? null : `/api/timeline${qs({ start: from, end: to })}`);
  const [historyOpen, setHistoryOpen] = useState(false);

  const openMenu = async () => {
    const href = await dialog.show<string | null>({
      title: 'Add to the schedule',
      message: other ? `${other.name} approves each item before it takes effect.` : undefined,
      actions: [
        { label: 'Request a change / swap', value: routes.scheduleChange(), variant: 'primary' },
        { label: 'Regular schedule', value: routes.schedulePattern, variant: 'default' },
        { label: 'Holiday or period', value: routes.scheduleHoliday, variant: 'default' },
        { label: 'Change primary parent', value: routes.schedulePrimary, variant: 'default' },
        { label: 'Cancel', value: null, variant: 'link' },
      ],
      dismissValue: null,
    });
    if (href) go(href);
  };

  const refresh = async () => { await Promise.all([rulesQ.refresh(), shareQ.reload()]); };

  return (
    <Screen
      headerTitle="Custody schedule"
      headerRight={isParent ? () => <IconButton icon="add" accessibilityLabel="Add to the schedule" onPress={openMenu} testID="schedule-add" /> : undefined}
      refreshing={rulesQ.refreshing}
      onRefresh={refresh}
      testID="schedule-screen"
    >
      <AppText variant="subhead" tone="muted" style={{ marginBottom: t.spacing.md }}>
        Layers: primary parent (background) → regular schedule → holidays → one-time changes. Higher layers win.
      </AppText>

      {isParent ? (
        <View style={{ marginBottom: t.spacing.lg }}>
          <Button title="Request a change / swap" icon="swap-horizontal" variant="primary" block onPress={() => go(routes.scheduleChange())} testID="schedule-request-change" />
          <ButtonRow>
            <Button title="Regular schedule" icon="repeat" size="sm" onPress={() => go(routes.schedulePattern)} testID="schedule-add-pattern" />
            <Button title="Holiday / period" icon="gift-outline" size="sm" onPress={() => go(routes.scheduleHoliday)} testID="schedule-add-holiday" />
          </ButtonRow>
        </View>
      ) : null}

      {isParent && !other ? (
        <Callout tone="warn">Your co-parent hasn't joined yet. Items you add take effect now, marked "not yet confirmed", until they confirm them.</Callout>
      ) : null}

      <AsyncView state={rulesQ}>
        {(rules) => {
          const waiting = rules.filter((r) => (['pending', 'unconfirmed'].includes(r.status) && r.requested_by !== myId)
            || (r.retire_requested_by != null && r.retire_requested_by !== myId));
          const mine = rules.filter((r) => r.status === 'pending' && r.requested_by === myId);
          const history = rules.filter((r) => HISTORY.includes(r.status)).reverse();
          return (
            <>
              {waiting.length ? (
                <Section title={isParent ? 'Waiting for your decision' : 'Waiting for approval'}>
                  {waiting.map((r) => <RuleRow key={r.id} rule={r} tone="warn" testID={`waiting-rule-${r.id}`} />)}
                </Section>
              ) : null}
              {isParent && mine.length ? (
                <Section title="Your requests awaiting the other parent">
                  {mine.map((r) => <RuleRow key={r.id} rule={r} testID={`mine-rule-${r.id}`} />)}
                </Section>
              ) : null}

              <Section title="Time share" footer="Based on approved items (and not-yet-confirmed ones until your co-parent joins). Overnight = who has the children at 2:00 AM.">
                <Card>
                  <Row gap={10} align="flex-start">
                    <View style={{ flex: 1 }}><DateField label="From" value={from} onChange={setFrom} testID="share-from" /></View>
                    <View style={{ flex: 1 }}><DateField label="To (not included)" value={to} onChange={setTo} testID="share-to" /></View>
                  </Row>
                  {rangeError ? <AppText tone="bad" variant="footnote">{rangeError}</AppText>
                    : shareQ.data ? (
                      <View testID="share-table">
                        <AppText variant="footnote" tone="muted">{`${fmtDate(shareQ.data.start)} – ${fmtDate(shareQ.data.end)} (not included)`}</AppText>
                        <ShareTable share={shareQ.data.share} />
                      </View>
                    ) : shareQ.error ? <AppText tone="bad" variant="footnote">{shareQ.error.message}</AppText> : <Loading />}
                </Card>
              </Section>

              {RULE_GROUPS.map((g) => {
                const list = rules.filter((r) => r.type === g.type && IN_EFFECT.includes(r.status));
                return (
                  <Section
                    key={g.type}
                    title={g.title}
                    action={g.type === 'default' && isParent ? <Button title="Change primary parent" variant="link" size="sm" onPress={() => go(routes.schedulePrimary)} testID="schedule-change-primary" /> : undefined}
                  >
                    {list.length ? list.map((r) => <RuleRow key={r.id} rule={r} />) : <AppText tone="muted" style={{ marginHorizontal: 4, marginBottom: 8 }}>{g.empty}</AppText>}
                  </Section>
                );
              })}

              <Section>
                <Pressable
                  onPress={() => setHistoryOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: historyOpen }}
                  style={({ pressed }) => [{ minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 }]}
                  testID="schedule-history-toggle"
                >
                  <Ionicons name={historyOpen ? 'chevron-down' : 'chevron-forward'} size={18} color={t.colors.muted} />
                  <AppText variant="footnote" tone="muted" style={{ marginLeft: 6, letterSpacing: 0.4 }}>{`HISTORY (REJECTED, WITHDRAWN, ENDED) · ${history.length}`}</AppText>
                </Pressable>
                {historyOpen ? (history.length ? history.map((r) => <RuleRow key={r.id} rule={r} />) : <AppText tone="muted" style={{ marginHorizontal: 4 }}>Nothing yet.</AppText>) : null}
              </Section>
            </>
          );
        }}
      </AsyncView>
    </Screen>
  );
}
