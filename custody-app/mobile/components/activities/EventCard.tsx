import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Badge, Card, ParentDot, StatusBadge } from '@/components/ui';
import { fmtDT, fmtT, money } from '@/lib/format';
import { childNames, nameOf } from '@/lib/hooks';
import { useTheme, type Tone } from '@/lib/theme';
import type { EventInstance, Me } from '@/lib/types';
import { driverDiffers } from './constants';

/** "during Sam's time" / "during your time" */
export const custodyText = (me: Me, id: number | null) => (id == null ? 'Nobody scheduled' : id === me.user.id ? 'during your time' : `during ${nameOf(me, id)}'s time`);
export const driverText = (me: Me, id: number | null) => (id == null ? 'No driver set' : id === me.user.id ? 'You are driving' : `${nameOf(me, id)} driving`);

/**
 * One activity occurrence: title, status, repeats badge, time, children, location,
 * whose custody time it falls in, driver (with a warning when the driver is not the
 * custodial parent) and cost. `showDate` prints the full date (lists not grouped by day).
 */
export function EventCard({ me, e, tz, showDate, onPress, tone, children }: {
  me: Me; e: EventInstance; tz: string; showDate?: boolean; onPress?: () => void; tone?: Tone; children?: ReactNode;
}) {
  const t = useTheme();
  const when = showDate ? `${fmtDT(e.start, tz)}–${fmtT(e.end, tz)}` : `${fmtT(e.start, tz)}–${fmtT(e.end, tz)}`;
  const kids = childNames(me, e.child_ids);
  return (
    <Card onPress={onPress} tone={tone} accessibilityLabel={`${e.title}, ${when}`} testID={`event-${e.id}-${e.instance_date}`}>
      <View style={styles.head}>
        <AppText weight="600" style={{ flex: 1 }} numberOfLines={2}>{e.title}</AppText>
        {showDate ? null : <AppText variant="subhead" tone="muted" style={{ marginLeft: 8 }}>{when}</AppText>}
      </View>
      {showDate ? <AppText variant="subhead" tone="muted" style={{ marginTop: 2 }}>{when}</AppText> : null}
      <View style={styles.badges}>
        <StatusBadge status={e.status} />
        {e.recurrence ? <Badge label="Repeats" tone="accent" /> : null}
        {e.cost_cents ? <Badge label={money(e.cost_cents)} /> : null}
        {e.note_count ? (
          <View style={styles.inline}>
            <Ionicons name="chatbox-ellipses-outline" size={14} color={t.colors.muted} />
            <AppText variant="caption" tone="muted" style={{ marginLeft: 3 }}>{String(e.note_count)}</AppText>
          </View>
        ) : null}
      </View>
      {kids || e.location ? <AppText variant="footnote" tone="muted" style={{ marginTop: 6 }} numberOfLines={2}>{[kids, e.location].filter(Boolean).join(' · ')}</AppText> : null}
      <View style={[styles.inline, { marginTop: 4 }]}>
        <ParentDot id={e.custody_parent} size={8} />
        <AppText variant="footnote" tone="muted" style={{ marginLeft: 5, flexShrink: 1 }}>{`${custodyText(me, e.custody_parent)} · ${driverText(me, e.transport_parent)}`}</AppText>
      </View>
      {driverDiffers(e) ? (
        <View style={[styles.inline, { marginTop: 4 }]}>
          <Ionicons name="warning-outline" size={14} color={t.colors.warn} />
          <AppText variant="footnote" tone="warn" style={{ marginLeft: 4, flexShrink: 1 }}>Driver differs from the parent with custody.</AppText>
        </View>
      ) : null}
      {e.response_note ? <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }} numberOfLines={3}>{`Response: "${e.response_note}"`}</AppText> : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  inline: { flexDirection: 'row', alignItems: 'center' },
});
