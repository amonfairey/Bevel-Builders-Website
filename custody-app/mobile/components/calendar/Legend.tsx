import { StyleSheet, View } from 'react-native';
import { AppText, Dot } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import type { Member } from '@/lib/types';

/** Who each color is, plus the synced-calendar and "needs acknowledgement" styles. */
export function CalendarLegend({ parents, myId }: { parents: Member[]; myId: number }) {
  const t = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="summary" testID="calendar-legend">
      {parents.map((p) => (
        <View key={p.id} style={styles.item}>
          <Dot color={p.color} />
          <AppText variant="footnote" tone="muted">{p.id === myId ? `${p.name} (you)` : p.name}</AppText>
        </View>
      ))}
      <View style={styles.item}>
        <View style={[styles.swatch, { borderColor: t.colors.muted, borderStyle: 'dashed' }]} />
        <AppText variant="footnote" tone="muted">Synced calendars</AppText>
      </View>
      <View style={styles.item}>
        <View style={[styles.swatch, { backgroundColor: t.colors.warnSoft, borderColor: t.colors.warn }]} />
        <AppText variant="footnote" tone="muted">Needs acknowledgement</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, marginTop: 10, marginBottom: 18, paddingHorizontal: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 10, borderRadius: 2, borderWidth: 1 },
});
