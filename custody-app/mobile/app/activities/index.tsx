import { router, type Href } from 'expo-router';
import { AppText, Button, ButtonRow, EmptyState, ErrorView, HeaderButton, Loading, Screen, Section } from '@/components/ui';
import { EventCard } from '@/components/activities/EventCard';
import { activityHref } from '@/components/activities/constants';
import { useEventActions } from '@/components/activities/useEventActions';
import { addDays, fmtDate, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { EventInstance, EventsResponse } from '@/lib/types';

/**
 * Activities & appointments for the next 90 days, grouped by date, with the activities
 * the other parent proposed (or changed) that need my acknowledgement on top.
 */
export default function ActivitiesScreen() {
  const { me, tz, myId, isParent } = usePeople();
  const today = todayLocal(tz);
  const q = useApi<EventsResponse>(`/api/events?start=${today}&end=${addDays(today, 90)}`);
  const actions = useEventActions(tz, q.reload);
  const go = (href: string) => router.push(href as Href);

  let body;
  if (q.data === undefined) {
    body = q.error ? <ErrorView message={q.error.message} onRetry={q.reload} /> : <Loading />;
  } else {
    const events = q.data.events;
    // One entry per series (instances share the event id); the first is the next occurrence.
    const series = new Map<number, EventInstance>();
    for (const e of events) if (!series.has(e.id)) series.set(e.id, e);
    const pending = isParent ? [...series.values()].filter((e) => e.status === 'proposed' && e.created_by !== myId) : [];
    const byDate = new Map<string, EventInstance[]>();
    for (const e of events) {
      const list = byDate.get(e.instance_date) ?? [];
      list.push(e);
      byDate.set(e.instance_date, list);
    }
    body = (
      <>
        <AppText tone="muted" style={{ marginBottom: 16 }}>Sports, lessons, school events, doctor visits. Each one shows whose custody time it falls in and who is driving.</AppText>
        {pending.length ? (
          <Section title="Needs your acknowledgement">
            {pending.map((e) => (
              <EventCard key={`p-${e.id}`} me={me} e={e} tz={tz} showDate tone="warn" onPress={() => go(activityHref(e))}>
                <ButtonRow>
                  <Button title="Acknowledge" variant="ok" size="sm" icon="checkmark" onPress={() => actions.acknowledge(e)} testID={`event-ack-${e.id}`} />
                  <Button title="Decline" variant="danger" size="sm" onPress={() => actions.decline(e)} testID={`event-decline-${e.id}`} />
                </ButtonRow>
              </EventCard>
            ))}
          </Section>
        ) : null}
        {byDate.size ? [...byDate.entries()].map(([d, list]) => (
          <Section key={d} title={d === today ? `Today · ${fmtDate(d)}` : d === addDays(today, 1) ? `Tomorrow · ${fmtDate(d)}` : fmtDate(d)}>
            {list.map((e) => <EventCard key={`${e.id}-${e.instance_date}`} me={me} e={e} tz={tz} onPress={() => go(activityHref(e))} />)}
          </Section>
        )) : (
          <EmptyState icon="football-outline" title="Nothing scheduled" message="Nothing in the next 90 days."
            actionLabel={isParent ? 'Add an activity' : undefined} onAction={isParent ? () => go(routes.editActivity()) : undefined} />
        )}
      </>
    );
  }

  return (
    <Screen
      headerTitle="Activities"
      headerRight={isParent ? () => <HeaderButton title="Add" bold onPress={() => go(routes.editActivity())} testID="activities-add" /> : undefined}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
      testID="activities-screen"
    >
      {body}
    </Screen>
  );
}
