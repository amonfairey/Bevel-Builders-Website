import { useCallback } from 'react';
import { AppText, AsyncView, Button, Card, ListGroup, Screen, Section, ShareTable } from '@/components/ui';
import { ActivityRow } from '@/components/home/ActivityRow';
import { AttentionList, BalanceCard, CallsThisWeek, InviteBanner, NotificationsBell, NowCard } from '@/components/home/HomeCards';
import { go } from '@/components/home/nav';
import { useBadges } from '@/lib/badges';
import { fmtDate, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { Dashboard } from '@/lib/types';

/**
 * Home (web portal VIEWS.dashboard): who has the kids now and the next exchange, decisions
 * waiting on you, the reimbursement balance, this year's time share, the next 14 days of
 * activities and this week's call compliance. View-only members see the read-only parts.
 */
export default function HomeScreen() {
  const { me, tz, other, isParent } = usePeople();
  const badges = useBadges();
  const q = useApi<Dashboard>('/api/dashboard');
  const today = todayLocal(tz);

  const onRefresh = useCallback(() => {
    void Promise.all([q.refresh(), badges.refresh()]);
  }, [q, badges]);

  return (
    <Screen
      title={`Hi, ${me.user.name}`}
      subtitle={fmtDate(today)}
      titleRight={<NotificationsBell count={badges.unreadNotifications} />}
      refreshing={q.refreshing}
      onRefresh={onRefresh}
      testID="home-screen"
    >
      {isParent && !other ? <InviteBanner code={me.family.invite_code} /> : null}
      <AsyncView state={q}>
        {(d) => (
          <>
            <NowCard d={d} />

            {isParent ? (
              <Section title="Needs your attention">
                <AttentionList pending={d.pending} unreadNotifications={badges.unreadNotifications} />
              </Section>
            ) : null}

            {d.balance ? <BalanceCard b={d.balance} /> : null}

            <Section
              title={`Parenting time ${today.slice(0, 4)}`}
              footer="Scheduled time for the full year. An overnight counts for whoever has the children at 2:00 AM."
              style={{ marginTop: 12 }}
            >
              <Card testID="home-share">
                <ShareTable share={d.share_year} />
                {d.share_ytd.byParent.length ? (
                  <AppText variant="footnote" tone="muted" style={{ marginTop: 8 }} testID="home-ytd">
                    {`Year to date: ${d.share_ytd.byParent.map((p) => `${p.name} ${p.pct}%`).join(' · ')}`}
                  </AppText>
                ) : null}
              </Card>
            </Section>

            <Section
              title="Next 14 days"
              action={<Button title="All activities" variant="link" size="sm" onPress={() => go(routes.activities)} testID="home-all-activities" />}
            >
              {d.upcoming.length ? (
                <ListGroup>
                  {d.upcoming.map((e) => <ActivityRow key={`${e.id}-${e.instance_date}`} event={e} mode="upcoming" />)}
                </ListGroup>
              ) : (
                <Card testID="home-upcoming-empty">
                  <AppText tone="muted">No activities in the next 14 days.</AppText>
                  {isParent ? <Button title="Add an activity" variant="link" onPress={() => go(routes.editActivity())} /> : null}
                </Card>
              )}
            </Section>

            {d.compliance.length ? (
              <Section title="Calls this week" footer="Monday through today, per approved call schedule.">
                <CallsThisWeek compliance={d.compliance} />
              </Section>
            ) : null}
          </>
        )}
      </AsyncView>
    </Screen>
  );
}
