import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Badge, Button, Callout, Card, CountBadge, Divider, ListGroup, ListItem, ParentDot, Row, type IconName } from '@/components/ui';
import { sourceText } from '@/components/calendar/dayData';
import { fmtDT, money } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { TOUCH, useTheme } from '@/lib/theme';
import type { Balance, Compliance, Dashboard, PendingCounts } from '@/lib/types';
import { go, plural, untilText } from './nav';

/** Bell with the unread count, for the Home large-title row. */
export function NotificationsBell({ count }: { count: number }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => go(routes.notifications)}
      accessibilityRole="button"
      accessibilityLabel={count ? `Notifications, ${count} unread` : 'Notifications'}
      hitSlop={6}
      testID="home-bell"
      style={({ pressed }) => [styles.bell, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={count ? 'notifications' : 'notifications-outline'} size={26} color={t.colors.accent} />
      <CountBadge count={count} style={styles.bellBadge} />
    </Pressable>
  );
}

/** "Your co-parent hasn't joined yet" with the invite code and a way to Settings. */
export function InviteBanner({ code }: { code: string | null | undefined }) {
  return (
    <Callout tone="warn" title="Your co-parent hasn't joined yet">
      <View>
        <AppText variant="subhead">
          {code ? `Share your invite code ${code} from Settings. ` : 'Share your invite code from Settings. '}
          Until they join, schedule items you add are marked "not yet confirmed".
        </AppText>
        <Button title="Invite code in Settings" size="sm" icon="person-add-outline" onPress={() => go(routes.settings)} style={{ marginTop: 8 }} testID="home-invite" />
      </View>
    </Callout>
  );
}

/** Who has the kids right now and the next hand-off. */
export function NowCard({ d }: { d: Dashboard }) {
  const t = useTheme();
  const { tz, myId, nameOf, isParent } = usePeople();
  const nowP = d.now.parent;
  const x = d.next_exchange;
  const toWhom = (id: number | null) => (id === myId ? 'you' : nameOf(id));
  return (
    <Card onPress={() => go(routes.calendar)} accessibilityLabel="Open the calendar" testID="home-now">
      <AppText variant="footnote" tone="muted">Right now the kids are with</AppText>
      <Row gap={10} style={{ marginTop: 4 }}>
        <ParentDot id={nowP} size={14} />
        <AppText variant="title2" testID="home-now-parent" numberOfLines={1} style={{ flexShrink: 1 }}>
          {nowP ? (nowP === myId ? 'You' : nameOf(nowP)) : 'Nobody assigned'}
        </AppText>
      </Row>
      {!nowP && isParent ? (
        <Button title="Set up the schedule" variant="link" onPress={() => go(routes.schedule)} />
      ) : null}
      <View style={{ marginVertical: t.spacing.md }}><Divider /></View>
      {x ? (
        <View testID="home-next-exchange">
          <AppText variant="footnote" tone="muted">Next exchange</AppText>
          <Row gap={8} wrap style={{ marginTop: 2 }}>
            <AppText variant="headline">{fmtDT(x.at, tz)}</AppText>
            <Badge label={untilText(x.at)} tone="accent" />
          </Row>
          <Row gap={6} style={{ marginTop: 4 }}>
            <ParentDot id={x.to} />
            <AppText variant="subhead">{`To ${toWhom(x.to)}${x.from != null ? ` from ${toWhom(x.from)}` : ''}`}</AppText>
          </Row>
          <AppText variant="footnote" tone="muted" style={{ marginTop: 2 }}>{sourceText(x.src)}</AppText>
        </View>
      ) : (
        <AppText tone="muted">No exchanges in the next 60 days.</AppText>
      )}
    </Card>
  );
}

type AttentionKey = keyof PendingCounts | 'notifications';
const ATTENTION: { key: AttentionKey; icon: IconName; color: string; route: string; label: (n: number) => string }[] = [
  { key: 'rules', icon: 'git-compare', color: '#2f6f9f', route: routes.schedule, label: (n) => `${plural(n, 'custody schedule item')} ${n === 1 ? 'needs' : 'need'} your decision` },
  { key: 'events', icon: 'football', color: '#2e8a6a', route: routes.activities, label: (n) => `${plural(n, 'activity change')} to acknowledge` },
  { key: 'expenses', icon: 'receipt', color: '#a76a00', route: routes.money, label: (n) => `${plural(n, 'expense')} to approve or dispute` },
  { key: 'payments', icon: 'cash', color: '#2e7d55', route: routes.money, label: (n) => `${plural(n, 'payment')} to confirm you received` },
  { key: 'call_rules', icon: 'videocam', color: '#6b5ea8', route: routes.calls, label: (n) => `${plural(n, 'call schedule')} to approve` },
  { key: 'calls', icon: 'call', color: '#6b5ea8', route: routes.calls, label: (n) => `${plural(n, 'call log')} to confirm or dispute` },
  { key: 'messages', icon: 'chatbubbles', color: '#2f6f9f', route: routes.messages, label: (n) => `${plural(n, 'unread message')}` },
  { key: 'notifications', icon: 'notifications', color: '#b33a3a', route: routes.notifications, label: (n) => `${plural(n, 'unread notification')}` },
];

/** "Needs your attention": one row per non-zero pending count, linking to its screen. */
export function AttentionList({ pending, unreadNotifications }: { pending: PendingCounts; unreadNotifications: number }) {
  const t = useTheme();
  const counts: Record<AttentionKey, number> = { ...pending, notifications: unreadNotifications };
  const items = ATTENTION.filter((a) => (counts[a.key] ?? 0) > 0);
  if (!items.length) {
    return (
      <Card testID="home-attention-empty">
        <Row gap={10}>
          <Ionicons name="checkmark-circle" size={22} color={t.colors.ok} />
          <AppText tone="muted">Nothing waiting on you.</AppText>
        </Row>
      </Card>
    );
  }
  return (
    <ListGroup>
      {items.map((a) => (
        <ListItem key={a.key} title={a.label(counts[a.key])} icon={a.icon} iconColor={a.color} onPress={() => go(a.route)} testID={`attention-${a.key}`} />
      ))}
    </ListGroup>
  );
}

/** Reimbursement balance (parents only). */
export function BalanceCard({ b }: { b: Balance }) {
  const { other } = usePeople();
  const otherName = other?.name ?? 'Your co-parent';
  const headline = b.net_cents === 0 ? 'Even' : b.net_cents > 0 ? `${otherName} owes you ${money(b.net_cents)}` : `You owe ${money(-b.net_cents)}`;
  return (
    <Card onPress={() => go(routes.money)} accessibilityLabel={`Reimbursement balance: ${headline}. Open Money`} testID="home-balance">
      <Row justify="space-between">
        <AppText variant="footnote" tone="muted">Reimbursement balance</AppText>
        <AppText variant="footnote" tone="accent">Money ›</AppText>
      </Row>
      <AppText variant="title3" tone={b.net_cents < 0 ? 'warn' : b.net_cents > 0 ? 'ok' : 'ink'} style={{ marginTop: 4 }}>{headline}</AppText>
      <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>
        {`Pending: ${money(b.pending_to_me)} to you, ${money(b.pending_from_me)} from you`}
      </AppText>
      {b.disputed_cents ? <AppText variant="footnote" tone="bad">{`Disputed: ${money(b.disputed_cents)}`}</AppText> : null}
      {b.unconfirmed_payments ? <AppText variant="footnote" tone="warn">{`${plural(b.unconfirmed_payments, 'payment')} to you awaiting your confirmation`}</AppText> : null}
    </Card>
  );
}

/** Call schedule compliance for this week (Monday to today). */
export function CallsThisWeek({ compliance }: { compliance: Compliance[] }) {
  const t = useTheme();
  return (
    <ListGroup>
      {compliance.map((c) => {
        const missed = c.totals.missed_not_facilitated + c.totals.missed_not_called;
        const allowed = c.rule.period === 'week' ? String(c.totals.allowed) : `${c.totals.allowed} (this ${c.rule.period})`;
        return (
          <ListItem
            key={c.rule.id}
            title={c.rule.name}
            subtitle={`For ${c.rule.entitled}: ${c.totals.completed} of ${allowed} completed${c.totals.short ? ` · ${c.totals.short} cut short` : ''}${c.totals.disputed ? ` · ${c.totals.disputed} disputed` : ''}`}
            icon="videocam"
            iconColor="#6b5ea8"
            right={missed ? <Badge label={`${missed} missed`} tone="bad" /> : <Ionicons name="checkmark-circle" size={20} color={c.totals.completed >= c.totals.allowed && c.totals.allowed > 0 ? t.colors.ok : t.colors.muted} />}
            onPress={() => go(routes.calls)}
            testID={`calls-rule-${c.rule.id}`}
          />
        );
      })}
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  bell: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: 2, right: 0 },
});
