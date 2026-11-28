import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppText, tapHaptic } from '@/components/ui';
import { DAYS, fmtDate } from '@/lib/format';
import { useTheme, type AppTheme } from '@/lib/theme';
import type { EventInstance, ExternalEvent, TimelineInterval } from '@/lib/types';
import { eventsOn, externalOn, segmentsOn, specialSource } from './dayData';

export interface MonthGridProps {
  /** 'YYYY-MM' being shown (other days are dimmed) */
  month: string;
  /** every date of the grid, whole weeks starting Sunday */
  dates: string[];
  today: string;
  tz: string;
  timeline: TimelineInterval[] | undefined;
  events: EventInstance[] | undefined;
  external: ExternalEvent[] | undefined;
  colorOf: (id: number | null | undefined) => string;
  nameOf: (id: number | null | undefined) => string;
  onPressDay: (date: string) => void;
}

/** Lines of text a cell shows below the day number (the holiday label may take two). */
const MAX_LINES = 3;

/**
 * Month grid like the web portal's calendar: a thin bar per day split by who has the kids,
 * the day number (today circled), the holiday / one-time change name and the first
 * activities. Sized for phone width: event lines show the title only, one line each.
 */
export function MonthGrid({ month, dates, today, tz, timeline, events, external, colorOf, nameOf, onPressDay }: MonthGridProps) {
  const t = useTheme();
  const weeks: string[][] = [];
  for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
  return (
    <View style={[styles.grid, { backgroundColor: t.colors.panel, borderColor: t.colors.line }]} testID="month-grid">
      <View style={[styles.week, { borderBottomColor: t.colors.line }]}>
        {DAYS.map((d) => (
          <View key={d} style={styles.dowCell}>
            <AppText variant="caption" tone="muted" weight="600" align="center">{d.slice(0, 1)}</AppText>
          </View>
        ))}
      </View>
      {weeks.map((w, wi) => (
        <View key={w[0]} style={[styles.week, wi < weeks.length - 1 && { borderBottomColor: t.colors.line, borderBottomWidth: StyleSheet.hairlineWidth }]}>
          {w.map((d, di) => (
            <DayCell
              key={d}
              date={d}
              inMonth={d.slice(0, 7) === month}
              isToday={d === today}
              lastCol={di === 6}
              tz={tz}
              timeline={timeline}
              events={events}
              external={external}
              colorOf={colorOf}
              nameOf={nameOf}
              onPress={onPressDay}
              t={t}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

interface DayCellProps {
  date: string; inMonth: boolean; isToday: boolean; lastCol: boolean; tz: string;
  timeline: TimelineInterval[] | undefined; events: EventInstance[] | undefined; external: ExternalEvent[] | undefined;
  colorOf: (id: number | null | undefined) => string; nameOf: (id: number | null | undefined) => string;
  onPress: (date: string) => void; t: AppTheme;
}

const DayCell = memo(function DayCell({ date, inMonth, isToday, lastCol, tz, timeline, events, external, colorOf, nameOf, onPress, t }: DayCellProps) {
  const segs = segmentsOn(timeline, date, tz);
  const evs = eventsOn(events, date, tz);
  const ext = externalOn(external, date, tz);
  const special = specialSource(segs);
  const lines: { key: string; text: string; color: string; ext?: boolean; proposed?: boolean }[] = [
    ...evs.map((e) => ({ key: `e${e.id}-${e.instance_date}`, text: e.title, color: colorOf(e.transport_parent || e.custody_parent), proposed: e.status === 'proposed' })),
    ...ext.map((e) => ({ key: `x${e.id}`, text: e.title, color: t.colors.muted, ext: true })),
  ];
  const room = MAX_LINES - (special ? 2 : 0);
  const shown = lines.length > room ? lines.slice(0, Math.max(0, room - 1)) : lines;
  const more = lines.length - shown.length;

  const who = [...new Set(segs.map((s) => nameOf(s.parent)))].join(' and ');
  const label = [
    fmtDate(date),
    isToday ? 'today' : null,
    who ? `with ${who}` : null,
    special ? special.name : null,
    evs.length ? `${evs.length} ${evs.length === 1 ? 'activity' : 'activities'}` : null,
    ext.length ? `${ext.length} synced ${ext.length === 1 ? 'event' : 'events'}` : null,
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      onPress={() => { tapHaptic(); onPress(date); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`day-${date}`}
      style={({ pressed }) => [
        styles.cell,
        !lastCol && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: t.colors.line },
        pressed && { backgroundColor: t.colors.soft },
      ]}
    >
      <View style={{ opacity: inMonth ? 1 : 0.4, flex: 1 }}>
        <View style={[styles.strip, { backgroundColor: t.colors.soft }]}>
          {segs.map((s, i) => <View key={i} style={{ flex: s.frac, backgroundColor: colorOf(s.parent) }} />)}
        </View>
        <View style={styles.numRow}>
          <View style={[styles.num, isToday && { backgroundColor: t.colors.accent }]}>
            <Text style={[styles.numText, { color: isToday ? t.colors.accentInk : t.colors.ink, fontWeight: isToday ? '700' : '500' }]}>{Number(date.slice(8))}</Text>
          </View>
        </View>
        {special ? <Text numberOfLines={2} style={[styles.line, styles.hol, { color: t.colors.accent }]}>{special.name}</Text> : null}
        {shown.map((l) => (
          <View
            key={l.key}
            style={[
              styles.ev,
              l.ext
                ? { borderLeftColor: t.colors.muted, borderStyle: 'dashed', borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.muted, borderLeftWidth: 2 }
                : { borderLeftColor: l.color, backgroundColor: l.proposed ? t.colors.warnSoft : t.colors.soft },
            ]}
          >
            <Text numberOfLines={1} style={[styles.line, { color: l.ext ? t.colors.muted : t.colors.ink, fontStyle: l.proposed ? 'italic' : 'normal' }]}>{l.text}</Text>
          </View>
        ))}
        {more > 0 ? <Text numberOfLines={1} style={[styles.line, { color: t.colors.muted }]}>{`+${more} more`}</Text> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  grid: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  week: { flexDirection: 'row' },
  dowCell: { flex: 1, paddingVertical: 6 },
  cell: { flex: 1, minHeight: 80, minWidth: 0, paddingBottom: 3 },
  strip: { flexDirection: 'row', height: 5, overflow: 'hidden' },
  numRow: { alignItems: 'center', marginTop: 3, marginBottom: 2 },
  num: { minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  numText: { fontSize: 14, lineHeight: 18 },
  line: { fontSize: 10, lineHeight: 13, paddingHorizontal: 2 },
  hol: { fontWeight: '700', textAlign: 'center' },
  ev: { borderLeftWidth: 2, borderRadius: 2, marginHorizontal: 2, marginTop: 1, overflow: 'hidden' },
});
