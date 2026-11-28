import { StyleSheet, View } from 'react-native';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import type { Me, Share, ShareRow } from '@/lib/types';
import { AppText } from './AppText';
import { Dot } from './Badge';

function useMeMaybe(): Me | null {
  const { me } = useSession();
  return me && me.family ? (me as Me) : null;
}

/** Colored dot for a family member by user id (grey when unassigned). */
export function ParentDot({ id, size = 10 }: { id: number | null | undefined; size?: number }) {
  const me = useMeMaybe();
  const t = useTheme();
  const color = me?.members.find((m) => m.id === id)?.color ?? t.colors.unassigned;
  return <Dot color={color} size={size} />;
}

function colorFor(me: Me | null, id: number | null, fallback: string) {
  return me?.members.find((m) => m.id === id)?.color ?? fallback;
}

/** Horizontal bar of each parent's share of time (web portal `.share-bar`). */
export function ShareBar({ share, height = 14 }: { share: Pick<Share, 'byParent'> | null | undefined; height?: number }) {
  const me = useMeMaybe();
  const t = useTheme();
  const rows = share?.byParent ?? [];
  return (
    <View
      style={[styles.bar, { height, borderRadius: height / 2, backgroundColor: t.colors.soft }]}
      accessibilityRole="image"
      accessibilityLabel={rows.map((p) => `${p.name} ${p.pct}%`).join(', ')}
    >
      {rows.map((p, i) => <View key={`${p.parent}-${i}`} style={{ flex: Math.max(0, p.pct), backgroundColor: colorFor(me, p.parent, t.colors.unassigned) }} />)}
    </View>
  );
}

/**
 * Bar + table with time %, overnights (count and %) and hours per parent; the same
 * information as the web portal's shareView(). Shows "No schedule yet." when empty.
 */
export function ShareTable({ share }: { share: Pick<Share, 'byParent'> | null | undefined }) {
  const me = useMeMaybe();
  const t = useTheme();
  const rows: ShareRow[] = share?.byParent ?? [];
  if (!rows.length) return <AppText tone="muted" style={{ paddingVertical: 8 }}>No schedule yet.</AppText>;
  const cell = { variant: 'subhead' as const, style: styles.num };
  return (
    <View>
      <ShareBar share={share} />
      <View style={[styles.row, { borderBottomColor: t.colors.line }]}>
        <AppText variant="footnote" tone="muted" style={{ flex: 1 }}>Parent</AppText>
        <AppText variant="footnote" tone="muted" style={styles.num}>Time</AppText>
        <AppText variant="footnote" tone="muted" style={styles.numWide}>Overnights</AppText>
        <AppText variant="footnote" tone="muted" style={styles.num}>Hours</AppText>
      </View>
      {rows.map((p, i) => (
        <View key={`${p.parent}-${i}`} style={[styles.row, { borderBottomColor: t.colors.line }]} accessibilityLabel={`${p.name}: ${p.pct}% of the time, ${p.overnights} overnights, ${Math.round(p.hours)} hours`}>
          <View style={styles.who}>
            <Dot color={colorFor(me, p.parent, t.colors.unassigned)} />
            <AppText variant="subhead" style={{ marginLeft: 6, flexShrink: 1 }} numberOfLines={1}>{p.parent != null && p.parent === me?.user.id ? `${p.name} (you)` : p.name}</AppText>
          </View>
          <AppText {...cell}>{`${p.pct}%`}</AppText>
          <AppText variant="subhead" style={styles.numWide}>{`${p.overnights} (${p.nightPct}%)`}</AppText>
          <AppText {...cell}>{String(Math.round(p.hours))}</AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', overflow: 'hidden', marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingRight: 6 },
  num: { width: 56, textAlign: 'right' },
  numWide: { width: 96, textAlign: 'right' },
});
