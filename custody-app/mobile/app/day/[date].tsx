import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { AppText, Badge, Button, Card, ErrorView, ListGroup, ListItem, Loading, NotesPanel, ParentDot, Row, Screen, Section } from '@/components/ui';
import { externalOn, eventsOn, segmentsOn, sourceKind, sourceText, specialSource, transitionsOn } from '@/components/calendar/dayData';
import { ActivityRow } from '@/components/home/ActivityRow';
import { go } from '@/components/home/nav';
import { qs } from '@/lib/api';
import { addDays, fmtDate, fmtT, isDate, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useTheme } from '@/lib/theme';
import type { EventsResponse, TimelineResponse } from '@/lib/types';

/**
 * One calendar day (web portal dayModal): custody blocks with times and the schedule item
 * behind each, hand-offs, activities, synced-calendar events, day notes, and (parents, once
 * the co-parent has joined) a change request for the day.
 */
export default function DayScreen() {
  const { date: raw } = useLocalSearchParams<{ date?: string }>();
  const date = typeof raw === 'string' && isDate(raw) ? raw : null;
  if (!date) {
    return (
      <Screen headerTitle="Day">
        <ErrorView title="Unknown day" message="This link does not point to a valid date." onRetry={() => go(routes.calendar)} />
      </Screen>
    );
  }
  return <DayDetail date={date} />;
}

function DayDetail({ date }: { date: string }) {
  const t = useTheme();
  const { tz, myId, nameOf, isParent, other } = usePeople();
  const end = addDays(date, 1);
  const tl = useApi<TimelineResponse>(`/api/timeline${qs({ start: date, end })}`);
  const ev = useApi<EventsResponse>(`/api/events${qs({ start: date, end })}`);

  const onRefresh = useCallback(() => { void Promise.all([tl.refresh(), ev.refresh()]); }, [tl, ev]);
  const step = (n: number) => router.setParams({ date: addDays(date, n) });
  const who = (id: number | null) => (id == null ? 'Unassigned' : id === myId ? `${nameOf(id)} (you)` : nameOf(id));

  const segs = segmentsOn(tl.data?.timeline, date, tz);
  const handoffs = transitionsOn(tl.data?.transitions, date, tz);
  const special = specialSource(segs);
  const evs = eventsOn(ev.data?.events, date, tz);
  const ext = externalOn(ev.data?.external, date, tz);
  const today = todayLocal(tz);

  return (
    <Screen headerTitle={fmtDate(date)} refreshing={tl.refreshing || ev.refreshing} onRefresh={onRefresh} testID="day-screen">
      <Row justify="space-between" style={{ marginBottom: t.spacing.md }}>
        <Button title="‹ Previous day" accessibilityLabel="Previous day" variant="link" onPress={() => step(-1)} testID="day-prev" />
        {date === today ? <Badge label="Today" tone="accent" /> : null}
        <Button title="Next day ›" accessibilityLabel="Next day" variant="link" onPress={() => step(1)} testID="day-next" />
      </Row>

      {special ? (
        <Card tone="accent">
          <AppText variant="footnote" tone="muted">{sourceKind(special)}</AppText>
          <AppText variant="headline">{special.name}</AppText>
        </Card>
      ) : null}

      <Section title="Custody">
        {tl.data === undefined ? (tl.error ? <ErrorView message={tl.error.message} onRetry={tl.reload} /> : <Loading />) : segs.length ? (
          <ListGroup>
            {segs.map((s, i) => (
              <ListItem
                key={`${s.start}-${i}`}
                left={<ParentDot id={s.parent} size={14} />}
                title={who(s.parent)}
                subtitle={`${s.frac > 0.999 ? 'All day' : s.label} · ${sourceText(s.src)}`}
                onPress={s.src.id != null ? () => go(routes.rule(s.src.id as number)) : undefined}
                testID={`day-seg-${i}`}
              />
            ))}
          </ListGroup>
        ) : (
          <Card><AppText tone="muted">No schedule covers this day yet.</AppText></Card>
        )}
        {handoffs.map((x, i) => (
          <Row key={`${x.at}-${i}`} gap={8} style={styles.handoff}>
            <Ionicons name="swap-horizontal" size={16} color={t.colors.muted} />
            <AppText variant="footnote" tone="muted" style={{ flex: 1 }}>{`Exchange at ${fmtT(x.at, tz)}: ${who(x.from)} to ${who(x.to)}`}</AppText>
          </Row>
        ))}
        {isParent && other ? (
          <Button
            title="Request a change for this day"
            icon="create-outline"
            block
            onPress={() => go(routes.scheduleChange(date))}
            style={{ marginTop: t.spacing.sm }}
            testID="day-request-change"
          />
        ) : null}
      </Section>

      <Section title="Activities">
        {ev.data === undefined ? (ev.error ? <ErrorView message={ev.error.message} onRetry={ev.reload} /> : <Loading />) : evs.length ? (
          <ListGroup>
            {evs.map((e) => <ActivityRow key={`${e.id}-${e.instance_date}`} event={e} mode="day" />)}
          </ListGroup>
        ) : (
          <Card><AppText tone="muted">None.</AppText></Card>
        )}
      </Section>

      {ext.length ? (
        <Section title="From synced calendars" footer="Read-only copies of your imported calendars.">
          <ListGroup>
            {ext.map((e) => (
              <ListItem
                key={e.id}
                left={<View style={[styles.extSwatch, { borderColor: t.colors.muted }]} />}
                title={e.title}
                subtitle={[e.all_day ? 'All day' : `${fmtT(e.start_ms, tz)}–${fmtT(e.end_ms, tz)}`, e.location || null, e.feed_name].filter(Boolean).join(' · ')}
                testID={`day-ext-${e.id}`}
              />
            ))}
          </ListGroup>
        </Section>
      ) : null}

      <NotesPanel targetType="day" targetId={date} title="Notes for this day" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  handoff: { paddingHorizontal: 4, marginTop: 2, marginBottom: 6 },
  extSwatch: { width: 14, height: 14, borderRadius: 3, borderWidth: 1, borderStyle: 'dashed' },
});
