import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AppText, Badge, Button, ButtonRow, Callout, Card, EmptyState, ErrorView, Loading, NotesPanel, ParentDot, Screen, Section, StatusBadge,
} from '@/components/ui';
import { custodyText, driverText } from '@/components/activities/EventCard';
import { driverDiffers, editActivityHref, eventCategoryLabel, recurrenceSummary } from '@/components/activities/constants';
import { useEventActions } from '@/components/activities/useEventActions';
import { useEventInstance } from '@/components/activities/useEventInstance';
import { fmtDT, fmtIso, fmtShortDate, fmtT, money } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useTheme } from '@/lib/theme';

function InfoRow({ label, children, testID }: { label: string; children: ReactNode; testID?: string }) {
  const t = useTheme();
  return (
    <View style={[styles.info, { borderBottomColor: t.colors.line }]} testID={testID}>
      <AppText variant="subhead" tone="muted" style={styles.infoLabel}>{label}</AppText>
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <AppText variant="subhead">{children}</AppText> : children}</View>
    </View>
  );
}

/** One activity occurrence (?date=) with acknowledge / decline / edit / skip / cancel / log a cost, and notes. */
export default function ActivityScreen() {
  const { id, date } = useLocalSearchParams<{ id?: string; date?: string }>();
  const { me, tz, myId, other, isParent, nameOf, childNames } = usePeople();
  const t = useTheme();
  const inst = useEventInstance(id, date, tz);
  const back = () => (router.canGoBack() ? router.back() : router.replace(routes.activities as Href));
  const actions = useEventActions(tz, inst.reload);

  const e = inst.event;
  if (!e) {
    return (
      <Screen headerTitle="Activity">
        {inst.loading ? <Loading /> : inst.error ? <ErrorView message={inst.error.message} onRetry={inst.reload} /> : (
          <EmptyState icon="football-outline" title="Activity not found" message="It may have been cancelled, or that date was skipped." actionLabel="All activities" onAction={() => router.replace(routes.activities as Href)} />
        )}
      </Screen>
    );
  }

  const theirs = e.created_by !== myId;
  const canRespond = isParent && e.status === 'proposed' && theirs;
  const startDate = e.start_local.slice(0, 10);
  const skipped = e.recurrence?.exdates ?? [];
  const logCost = () => {
    const href = routes.newExpense({ eventId: e.id, description: e.title, amount: e.cost_cents ? (e.cost_cents / 100).toFixed(2) : undefined });
    const kids = e.child_ids.length ? `${href.includes('?') ? '&' : '?'}children=${e.child_ids.join(',')}` : '';
    router.push(`${href}${kids}&date=${e.instance_date}` as Href);
  };

  return (
    <Screen headerTitle="Activity" refreshing={inst.refreshing} onRefresh={inst.refresh} testID="activity-detail">
      <Card>
        <AppText variant="title3" testID="activity-title">{e.title}</AppText>
        <AppText style={{ marginTop: 4 }}>{`${fmtDT(e.start, tz)}–${fmtT(e.end, tz)}`}</AppText>
        <View style={styles.badges}>
          <StatusBadge status={e.status} />
          {e.recurrence ? <Badge label="Repeats" tone="accent" /> : null}
          <Badge label={eventCategoryLabel(e.category)} />
        </View>
        {!inst.isExact && date ? <AppText variant="footnote" tone="muted" style={{ marginTop: 6 }}>{`Showing the next date; ${fmtShortDate(date)} is no longer on the calendar.`}</AppText> : null}
      </Card>

      {canRespond ? <Callout tone="warn" title="Needs your acknowledgement">{`${nameOf(e.created_by)} ${e.updated_at ? 'changed' : 'added'} this${e.recurrence ? ' (all repeats)' : ''}.`}</Callout> : null}
      {e.status === 'proposed' && !theirs ? <Callout tone="warn">{`Waiting for ${other?.name ?? 'your co-parent'} to acknowledge.`}</Callout> : null}
      {e.status === 'declined' ? <Callout tone="bad" title={`Declined by ${nameOf(e.responded_by)}`}>{e.response_note ? `"${e.response_note}"` : 'No reason given.'}</Callout> : null}
      {e.recurrence ? <Callout tone="neutral">Part of a repeating series. Edit and Cancel series apply to every date; Skip this date removes only this one.</Callout> : null}

      <Section title="Details">
        <Card padded={false} style={{ paddingHorizontal: 16 }}>
          <InfoRow label="Repeats">{e.recurrence ? recurrenceSummary(e.recurrence, startDate) : 'Does not repeat'}</InfoRow>
          <InfoRow label="Children">{childNames(e.child_ids) || 'Not specified'}</InfoRow>
          {e.location ? <InfoRow label="Location">{e.location}</InfoRow> : null}
          <InfoRow label="Custody">
            <View style={styles.inline}><ParentDot id={e.custody_parent} /><AppText variant="subhead" style={{ marginLeft: 6, flexShrink: 1 }}>{custodyText(me, e.custody_parent).replace(/^during /, 'During ')}</AppText></View>
          </InfoRow>
          <InfoRow label="Driver" testID="activity-driver">
            <AppText variant="subhead">{driverText(me, e.transport_parent)}</AppText>
            {driverDiffers(e) ? (
              <View style={[styles.inline, { marginTop: 2 }]}>
                <Ionicons name="warning-outline" size={14} color={t.colors.warn} />
                <AppText variant="footnote" tone="warn" style={{ marginLeft: 4, flexShrink: 1 }}>Driver differs from the parent with custody.</AppText>
              </View>
            ) : null}
          </InfoRow>
          {e.cost_cents ? <InfoRow label="Cost">{money(e.cost_cents)}</InfoRow> : null}
          {e.details ? <InfoRow label="Details">{e.details}</InfoRow> : null}
          <InfoRow label={e.updated_at ? 'Last changed' : 'Added'}>{`${nameOf(e.created_by)} · ${fmtIso(e.updated_at ?? e.created_at, tz)}`}</InfoRow>
          {e.responded_at && e.status !== 'declined' ? <InfoRow label="Response">{`${nameOf(e.responded_by)} · ${fmtIso(e.responded_at, tz)}${e.response_note ? `\n"${e.response_note}"` : ''}`}</InfoRow> : null}
          {skipped.length ? <InfoRow label="Skipped dates">{[...skipped].sort().map(fmtShortDate).join(', ')}</InfoRow> : null}
        </Card>
      </Section>

      {isParent ? (
        <Section title="Actions">
          {canRespond ? (
            <ButtonRow style={{ marginTop: 0, marginBottom: 8 }}>
              <Button title="Acknowledge" variant="ok" icon="checkmark" onPress={() => actions.acknowledge(e)} testID="activity-ack" />
              <Button title="Decline" variant="danger" onPress={() => actions.decline(e)} testID="activity-decline" />
            </ButtonRow>
          ) : null}
          <ButtonRow style={{ marginTop: 0 }}>
            <Button title={e.recurrence ? 'Edit series' : 'Edit'} icon="create-outline" onPress={() => router.push(editActivityHref(e) as Href)} testID="activity-edit" />
            <Button title="Log a cost" icon="receipt-outline" onPress={logCost} testID="activity-log-cost" />
            {e.recurrence ? <Button title="Skip this date" onPress={async () => { if (await actions.skip(e)) back(); }} testID="activity-skip" /> : null}
            <Button title={e.recurrence ? 'Cancel series' : 'Cancel activity'} variant="danger" onPress={async () => { if (await actions.cancel(e)) back(); }} testID="activity-cancel" />
          </ButtonRow>
        </Section>
      ) : null}

      <NotesPanel targetType="event" targetId={e.id} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  inline: { flexDirection: 'row', alignItems: 'center' },
  info: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel: { width: 110, paddingRight: 8 },
});
