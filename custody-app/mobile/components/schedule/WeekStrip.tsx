import { StyleSheet, View } from 'react-native';
import { AppText, Dot, Row } from '@/components/ui';
import { DAYS, addDays, daySegments, dow, fmtShortDate } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import type { TimelineInterval } from '@/lib/types';

/**
 * Week-by-week color strip of a timeline (the web portal's seg-preview, laid out for a
 * phone): one row per week, one cell per day, each day split by who has the children.
 */
export function WeekStrip({ timeline, start, days = 28 }: { timeline: TimelineInterval[]; start: string; days?: number }) {
  const t = useTheme();
  const { tz, colorOf, nameOf, myId } = usePeople();
  const weeks = Math.ceil(days / 7);
  const parentsSeen = [...new Set(timeline.map((iv) => iv.parent))];

  return (
    <View testID="week-strip">
      <Row gap={4} style={{ marginBottom: 4 }}>
        <View style={styles.weekLabel} />
        {Array.from({ length: 7 }, (_, i) => (
          <AppText key={i} variant="caption" tone="muted" align="center" style={{ flex: 1 }}>{DAYS[dow(addDays(start, i))].slice(0, 2)}</AppText>
        ))}
      </Row>
      {Array.from({ length: weeks }, (_, w) => {
        const weekStart = addDays(start, w * 7);
        return (
          <Row key={w} gap={4} style={{ marginBottom: 6 }}>
            <AppText variant="caption" tone="muted" style={styles.weekLabel} numberOfLines={1}>{fmtShortDate(weekStart)}</AppText>
            {Array.from({ length: 7 }, (_, d) => {
              const date = addDays(weekStart, d);
              const segs = w * 7 + d < days ? daySegments(timeline, date, tz) : [];
              return (
                <View
                  key={d}
                  style={[styles.day, { backgroundColor: t.colors.soft }]}
                  accessibilityLabel={segs.map((s) => `${nameOf(s.parent)} ${s.label}`).join(', ')}
                >
                  {segs.map((s, i) => <View key={i} style={{ flex: s.frac, backgroundColor: colorOf(s.parent) }} />)}
                </View>
              );
            })}
          </Row>
        );
      })}
      <Row wrap gap={14} style={{ marginTop: 2 }}>
        {parentsSeen.map((p) => (
          <Row key={String(p)} gap={6}>
            <Dot color={colorOf(p)} />
            <AppText variant="footnote">{p === myId ? `${nameOf(p)} (you)` : nameOf(p)}</AppText>
          </Row>
        ))}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  weekLabel: { width: 46 },
  day: { flex: 1, height: 22, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
});
