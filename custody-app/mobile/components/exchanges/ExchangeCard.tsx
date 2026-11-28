import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import * as Linking from 'expo-linking';
import { AppText, Badge, Button, ButtonRow, Card, NotesPanel, Row, useToast } from '@/components/ui';
import { fmtDT, fmtT } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { EXCHANGE_KIND } from '@/lib/status';
import type { Tone } from '@/lib/theme';
import type { Exchange } from '@/lib/types';
import { fmtAccuracy, mapsUrl } from './location';

/** Lateness label, same thresholds as the web portal (more than 5 minutes either way). */
export function lateness(minutes: number | null): { label: string; tone: Tone } | null {
  if (minutes == null) return null;
  if (minutes > 5) return { label: `${minutes} min late`, tone: 'warn' };
  if (minutes < -5) return { label: `${-minutes} min early`, tone: 'neutral' };
  return { label: 'On time', tone: 'ok' };
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Row align="flex-start" style={{ marginTop: 4 }}>
      <AppText variant="subhead" tone="muted" style={{ width: 92 }}>{label}</AppText>
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <AppText variant="subhead">{children}</AppText> : children}</View>
    </Row>
  );
}

/** One check-in: when, what, who, scheduled time and lateness, place, GPS link, notes. */
export function ExchangeCard({ x }: { x: Exchange }) {
  const { tz, childNames } = usePeople();
  const toast = useToast();
  const [notesOpen, setNotesOpen] = useState(false);
  const late = lateness(x.minutes_late);
  const kids = childNames(x.child_ids);
  const kindLabel = EXCHANGE_KIND[x.kind] ?? x.kind;
  const isProblem = x.kind === 'no_show_other' || x.kind === 'late_other';

  const openMap = async () => {
    if (x.lat == null || x.lng == null) return;
    try { await Linking.openURL(mapsUrl(x.lat, x.lng)); } catch { toast.show('Could not open Maps', { tone: 'bad' }); }
  };

  return (
    <Card tone={isProblem ? 'bad' : late?.tone === 'warn' ? 'warn' : undefined} testID={`exchange-${x.id}`}>
      <Row justify="space-between" align="flex-start">
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{kindLabel}</AppText>
          <AppText variant="subhead" tone="muted">{fmtDT(x.at_ms, tz)}</AppText>
        </View>
        {late ? <Badge label={late.label} tone={late.tone} /> : null}
      </Row>
      <View style={{ marginTop: 6 }}>
        <Line label="By">{x.logged_by_name}</Line>
        <Line label="Scheduled">{x.scheduled_ms ? fmtT(x.scheduled_ms, tz) : 'No exchange scheduled near this time'}</Line>
        {kids ? <Line label="Children">{kids}</Line> : null}
        {x.location ? <Line label="Place">{x.location}</Line> : null}
        {x.lat != null && x.lng != null ? (
          <Line label="GPS">
            <Button
              title={`Open in Maps ${fmtAccuracy(x.accuracy)}`.trim()}
              variant="link"
              icon="location-outline"
              onPress={openMap}
              accessibilityLabel={`Open the check-in location in Maps, accuracy ${fmtAccuracy(x.accuracy) || 'unknown'}`}
              testID={`exchange-${x.id}-map`}
            />
          </Line>
        ) : null}
        {x.details ? <Line label="Details">{x.details}</Line> : null}
      </View>
      <ButtonRow>
        <Button
          title={notesOpen ? 'Hide notes' : 'Notes'}
          icon="document-text-outline"
          size="sm"
          onPress={() => setNotesOpen((v) => !v)}
          testID={`exchange-${x.id}-notes`}
        />
      </ButtonRow>
      {notesOpen ? <View style={{ marginTop: 12 }}><NotesPanel targetType="exchange" targetId={x.id} /></View> : null}
    </Card>
  );
}
