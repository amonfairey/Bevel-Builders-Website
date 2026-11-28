import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Card } from '@/components/ui';
import { useTheme, type Tone } from '@/lib/theme';
import type { Compliance, CompliancePeriod } from '@/lib/types';
import { describeRule, periodLabel } from './format';

type Col = { key: keyof Omit<CompliancePeriod, 'start' | 'end' | 'declined_by_child'>; label: string; short: string; tone?: Tone };

/** The web portal's compliance columns, in the same order. */
const COLS: readonly Col[] = [
  { key: 'allowed', label: 'Allowed', short: 'Allowed' },
  { key: 'completed', label: 'Done', short: 'Done' },
  { key: 'missed_not_facilitated', label: 'Missed (not available)', short: 'Missed: not available', tone: 'bad' },
  { key: 'missed_not_called', label: 'Missed (no call)', short: 'Missed: no call', tone: 'bad' },
  { key: 'short', label: 'Short', short: 'Short', tone: 'warn' },
  { key: 'disputed', label: 'Disputed', short: 'Disputed', tone: 'bad' },
  { key: 'outside_window', label: 'Outside window', short: 'Outside window', tone: 'warn' },
];

const FIRST_W = 104;
const COL_W = 74;

/**
 * Compliance for one call schedule over the last 4 weeks: totals as tiles, then a per-period
 * table whose number columns scroll sideways under a fixed Period column.
 */
export function ComplianceCard({ c }: { c: Compliance }) {
  const t = useTheme();
  const toneOf = (col: Col, n: number): Tone | undefined => (n > 0 ? col.tone : undefined);
  const cell = (col: Col, n: number, allowed: number) => {
    const tone = col.key === 'completed' ? (n >= allowed ? 'ok' : n > 0 ? undefined : 'warn') : toneOf(col, n);
    return <AppText variant="subhead" weight={tone ? '600' : '400'} tone={tone ?? (n ? 'ink' : 'muted')} align="center">{String(n)}</AppText>;
  };

  return (
    <Card testID={`compliance-${c.rule.id}`}>
      <AppText variant="headline">{c.rule.name}</AppText>
      <AppText variant="footnote" tone="muted" style={{ marginTop: 2 }}>{`For ${c.rule.entitled} · ${describeRule(c.rule)}`}</AppText>

      <View style={styles.tiles}>
        {COLS.map((col) => {
          const n = c.totals[col.key];
          const tone = col.key === 'completed' ? (n >= c.totals.allowed ? 'ok' : 'warn') : toneOf(col, n);
          return (
            <View key={col.key} style={[styles.tile, { backgroundColor: tone ? t.toneSoft(tone) : t.colors.soft }]} testID={`compliance-${c.rule.id}-total-${col.key}`}>
              <AppText variant="title3" tone={tone ?? 'ink'}>{String(n)}</AppText>
              <AppText variant="caption" tone="muted" numberOfLines={3}>{col.label}</AppText>
            </View>
          );
        })}
      </View>

      <View style={[styles.table, { borderColor: t.colors.line }]}>
        <View style={{ width: FIRST_W }}>
          <View style={[styles.headCell, { borderBottomColor: t.colors.line, backgroundColor: t.colors.soft }]}>
            <AppText variant="caption" weight="600" tone="muted">Period</AppText>
          </View>
          {c.periods.map((p, i) => (
            <View key={p.start} style={[styles.cell, styles.firstCell, i % 2 ? { backgroundColor: t.colors.bg } : null]}>
              <AppText variant="footnote" numberOfLines={1}>{periodLabel(p, c.rule.period)}</AppText>
            </View>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }} testID={`compliance-${c.rule.id}-table`}>
          <View>
            <View style={[styles.row, styles.headCell, { borderBottomColor: t.colors.line, backgroundColor: t.colors.soft, paddingHorizontal: 0 }]}>
              {COLS.map((col) => (
                <View key={col.key} style={{ width: COL_W, paddingHorizontal: 4 }}>
                  <AppText variant="caption" weight="600" tone="muted" align="center" numberOfLines={3}>{col.short}</AppText>
                </View>
              ))}
            </View>
            {c.periods.map((p, i) => (
              <View key={p.start} style={[styles.row, styles.cell, i % 2 ? { backgroundColor: t.colors.bg } : null]}>
                {COLS.map((col) => <View key={col.key} style={{ width: COL_W }}>{cell(col, p[col.key], p.allowed)}</View>)}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
      {c.periods.length ? <AppText variant="caption" tone="muted" style={{ marginTop: 6 }}>{`Swipe the table sideways for every column.${c.rule.period === 'week' ? ' Weeks start on Monday.' : ''}`}</AppText> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  tile: { width: '23%', flexGrow: 1, minWidth: 70, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 },
  table: { flexDirection: 'row', marginTop: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  headCell: { height: 52, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { height: 36, justifyContent: 'center', alignItems: 'center' },
  firstCell: { paddingHorizontal: 8, alignItems: 'flex-start' },
});
