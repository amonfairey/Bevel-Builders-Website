import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { AppText, Button, Callout, Card, IconButton, Row, Screen, Section, ShareTable } from '@/components/ui';
import { CalendarLegend } from '@/components/calendar/Legend';
import { MonthGrid } from '@/components/calendar/MonthGrid';
import { monthEnd, monthGridRange } from '@/components/calendar/dayData';
import { qs } from '@/lib/api';
import { addMonths, MONTHS, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useTheme } from '@/lib/theme';
import type { EventsResponse, TimelineResponse } from '@/lib/types';

/**
 * Month calendar (web portal VIEWS.calendar): color bar = who has the kids, holiday and
 * one-time change names, activities and synced events. Tap a day for its details.
 */
export default function CalendarScreen() {
  const t = useTheme();
  const { me, tz, colorOf, nameOf, parents } = usePeople();
  const today = todayLocal(tz);
  const [month, setMonth] = useState(today.slice(0, 7));
  const grid = monthGridRange(month);

  const tl = useApi<TimelineResponse>(`/api/timeline${qs({ start: grid.start, end: grid.end })}`);
  const ev = useApi<EventsResponse>(`/api/events${qs({ start: grid.start, end: grid.end })}`);
  const share = useApi<TimelineResponse>(`/api/timeline${qs({ start: `${month}-01`, end: monthEnd(month) })}`);

  const [y, m] = month.split('-').map(Number);
  const loading = tl.loading || ev.loading;
  const error = tl.error || ev.error;
  const refreshing = tl.refreshing || ev.refreshing || share.refreshing;
  const onRefresh = useCallback(() => { void Promise.all([tl.refresh(), ev.refresh(), share.refresh()]); }, [tl, ev, share]);
  const openDay = useCallback((d: string) => router.push(routes.day(d) as Href), []);

  return (
    <Screen title="Calendar" refreshing={refreshing} onRefresh={onRefresh} testID="calendar-screen">
      <Row justify="space-between" style={{ marginBottom: t.spacing.sm }}>
        <Row gap={0}>
          <IconButton icon="chevron-back" accessibilityLabel="Previous month" onPress={() => setMonth(addMonths(month, -1))} testID="cal-prev" />
          <AppText variant="title3" style={{ minWidth: 150, textAlign: 'center' }} accessibilityRole="header" testID="cal-month">{`${MONTHS[m - 1]} ${y}`}</AppText>
          <IconButton icon="chevron-forward" accessibilityLabel="Next month" onPress={() => setMonth(addMonths(month, 1))} testID="cal-next" />
        </Row>
        <Row gap={8}>
          {loading ? <ActivityIndicator color={t.colors.muted} /> : null}
          <Button title="Today" size="sm" disabled={month === today.slice(0, 7)} onPress={() => setMonth(today.slice(0, 7))} testID="cal-today" />
        </Row>
      </Row>

      {error ? (
        <Callout tone="bad" title="Couldn't load the calendar">
          <View>
            <AppText variant="subhead">{error.message}</AppText>
            <Button title="Try again" size="sm" icon="refresh" onPress={() => Promise.all([tl.reload(), ev.reload()])} style={{ marginTop: 8 }} />
          </View>
        </Callout>
      ) : null}

      <MonthGrid
        month={month}
        dates={grid.dates}
        today={today}
        tz={tz}
        timeline={tl.data?.timeline}
        events={ev.data?.events}
        external={ev.data?.external}
        colorOf={colorOf}
        nameOf={nameOf}
        onPressDay={openDay}
      />
      <CalendarLegend parents={parents} myId={me.user.id} />

      <Section title="This month" footer="Overnight = who has the children at 2:00 AM. Tap a day for times, notes or a change request.">
        <Card>
          {share.data ? <ShareTable share={share.data.share} /> : share.error ? <AppText tone="muted">{share.error.message}</AppText> : <ActivityIndicator color={t.colors.muted} style={styles.spin} />}
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spin: { paddingVertical: 16 },
});
