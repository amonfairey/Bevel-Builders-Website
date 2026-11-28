import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { AppText, ParentDot, StatusBadge, tapHaptic } from '@/components/ui';
import { fmtDT, fmtT } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { TOUCH, useTheme } from '@/lib/theme';
import type { EventInstance } from '@/lib/types';

/**
 * One activity occurrence: title, status, time, location, whose custody time it falls in
 * and who drives (flagged when the driver is not the parent who has the kids then).
 * Tapping opens the activity. Used by Home (next 14 days) and the Day screen.
 */
export function ActivityRow({ event: e, mode }: { event: EventInstance; mode: 'upcoming' | 'day' }) {
  const t = useTheme();
  const { tz, myId, nameOf, youOr, childNames } = usePeople();
  const timeOf = (id: number | null) => (id === myId ? 'your time' : `${nameOf(id)}'s time`);
  const when = mode === 'day' ? `${fmtT(e.start, tz)}–${fmtT(e.end, tz)}` : fmtDT(e.start, tz);
  const kids = childNames(e.child_ids);
  const driverMismatch = e.transport_parent != null && e.custody_parent != null && e.transport_parent !== e.custody_parent;
  const meta = [when, e.location || null].filter(Boolean).join(' · ');
  const custody = e.custody_parent != null ? `During ${timeOf(e.custody_parent)}` : null;
  const driver = e.transport_parent != null ? `${youOr(e.transport_parent)} driving` : null;
  const showStatus = mode === 'day' || e.status !== 'accepted';

  return (
    <Pressable
      onPress={() => { tapHaptic(); router.push(routes.activity(e.id) as Href); }}
      accessibilityRole="button"
      accessibilityLabel={[e.title, meta, custody, driver, driverMismatch ? 'driver is not the parent with the children' : null].filter(Boolean).join(', ')}
      testID={`activity-${e.id}-${e.instance_date}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.colors.soft }]}
    >
      <View style={{ paddingTop: 5, marginRight: 10 }}><ParentDot id={e.custody_parent} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.head}>
          <AppText weight="600" style={{ flexShrink: 1 }} numberOfLines={2}>{e.title}</AppText>
          {showStatus ? <StatusBadge status={e.status} /> : null}
        </View>
        <AppText variant="footnote" tone="muted" numberOfLines={2}>{meta}</AppText>
        <AppText variant="footnote" tone="muted" numberOfLines={2}>{[custody, driver, kids || null].filter(Boolean).join(' · ')}</AppText>
        {driverMismatch ? (
          <View style={styles.flag}>
            <Ionicons name="car-outline" size={14} color={t.colors.warn} />
            <AppText variant="footnote" tone="warn">{`${youOr(e.transport_parent)} driving during ${timeOf(e.custody_parent)}`}</AppText>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.colors.muted} style={{ marginLeft: 6, alignSelf: 'center' }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', minHeight: TOUCH + 4, paddingHorizontal: 16, paddingVertical: 10 },
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
});
