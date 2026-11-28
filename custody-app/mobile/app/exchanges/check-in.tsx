import { useState } from 'react';
import { Platform, View } from 'react-native';
import { router, type Href } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  AppText, Button, ButtonRow, Callout, Card, EmptyState, Field, MultiSelect, Row, Screen, TextArea, useToast,
} from '@/components/ui';
import { fmtAccuracy, getMyLocation, type GeoFix } from '@/components/exchanges/location';
import { api, errorMessage } from '@/lib/api';
import { fmtT } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useTheme } from '@/lib/theme';
import type { ExchangeCreated, ExchangeKind } from '@/lib/types';

const KINDS: { value: ExchangeKind; label: string }[] = [
  { value: 'dropoff', label: 'I am dropping off' },
  { value: 'pickup', label: 'I am picking up' },
  { value: 'late_other', label: 'Other parent is late' },
  { value: 'no_show_other', label: 'Other parent did not show' },
];

type Geo =
  | { state: 'none' }
  | { state: 'busy' }
  | { state: 'ok'; fix: GeoFix }
  | { state: 'error'; message: string; openSettings: boolean };

/**
 * Exchange check-in (web portal exchangeForm), presented as a sheet. The server records the
 * time; location is attached only if the parent taps "Attach my location".
 */
export default function CheckInScreen() {
  const t = useTheme();
  const toast = useToast();
  const { me, tz, isParent } = usePeople();
  const [kind, setKind] = useState<ExchangeKind>('pickup');
  const [kids, setKids] = useState<number[]>(() => me.children.map((c) => c.id));
  const [place, setPlace] = useState('');
  const [details, setDetails] = useState('');
  const [geo, setGeo] = useState<Geo>({ state: 'none' });
  const [error, setError] = useState<string | null>(null);

  const done = () => (router.canGoBack() ? router.back() : router.replace(routes.exchanges as Href));

  const attach = async () => {
    setGeo({ state: 'busy' });
    const r = await getMyLocation();
    setGeo(r.ok ? { state: 'ok', fix: r.fix } : { state: 'error', message: r.message, openSettings: r.openSettings });
  };

  const submit = async () => {
    setError(null);
    try {
      const fix = geo.state === 'ok' ? geo.fix : null;
      const r = await api.post<ExchangeCreated>('/api/exchanges', {
        kind,
        child_ids: kids,
        location: place.trim(),
        details: details.trim(),
        ...(fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : {}),
      });
      toast.show(r.scheduled_ms != null
        ? `Checked in. Scheduled exchange was ${fmtT(r.scheduled_ms, tz)}.`
        : 'Checked in. No scheduled exchange near this time.', { tone: 'ok' });
      done();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!isParent) {
    return (
      <Screen headerTitle="Exchange check-in">
        <EmptyState icon="eye-outline" title="View-only access" message="Only the parents can check in at an exchange." />
      </Screen>
    );
  }

  return (
    <Screen
      headerTitle="Exchange check-in"
      footer={<Button title="Check in" icon="checkmark-circle" variant="primary" block onPress={submit} testID="check-in-submit" />}
      testID="check-in-screen"
    >
      <AppText variant="subhead" tone="muted" style={{ marginBottom: 16 }}>
        The server records the exact time when you tap Check in and compares it with the scheduled exchange.
      </AppText>

      <MultiSelect<ExchangeKind> label="What is happening" options={KINDS} values={[kind]} onChange={(v) => v[0] && setKind(v[0])} multiple={false} />

      {me.children.length ? (
        <MultiSelect<number> label="Children" options={me.children.map((c) => ({ value: c.id, label: c.name }))} values={kids} onChange={setKids} />
      ) : null}

      <Field label="Place" value={place} onChangeText={setPlace} placeholder="e.g. School front office" testID="check-in-place" />

      <Card style={{ marginBottom: 16 }}>
        <AppText variant="subhead" weight="600">Location (optional)</AppText>
        {geo.state === 'ok' ? (
          <View testID="check-in-geo-ok">
            <Row style={{ marginTop: 6 }} gap={6}>
              <AppText tone="ok" weight="600">{`Location attached (${fmtAccuracy(geo.fix.accuracy) || 'accuracy unknown'})`}</AppText>
            </Row>
            <AppText variant="footnote" tone="muted" selectable>{`${geo.fix.lat.toFixed(5)}, ${geo.fix.lng.toFixed(5)}`}</AppText>
            {geo.fix.accuracy != null && geo.fix.accuracy > 100 ? (
              <AppText variant="footnote" tone="warn" style={{ marginTop: 4 }}>The fix is not very precise. You can try again outside or near a window.</AppText>
            ) : null}
            <ButtonRow>
              <Button title="Try again" size="sm" icon="refresh" onPress={attach} />
              <Button title="Remove" size="sm" variant="danger" onPress={() => setGeo({ state: 'none' })} testID="check-in-geo-remove" />
            </ButtonRow>
          </View>
        ) : (
          <>
            <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>
              {Platform.OS === 'web' ? 'Attach where you are right now to this check-in.' : 'Attach where you are right now. CoParent Hub asks for location only when you tap this, and only while you are using the app.'}
            </AppText>
            {geo.state === 'error' ? (
              <Callout tone="bad" style={{ marginTop: 10, marginBottom: 0 }}>
                <AppText variant="subhead" testID="check-in-geo-error">{geo.message}</AppText>
                {geo.openSettings ? <Button title="Open Settings" variant="link" onPress={() => Linking.openSettings().catch(() => undefined)} /> : null}
              </Callout>
            ) : null}
            <Button
              title={geo.state === 'busy' ? 'Getting location…' : geo.state === 'error' ? 'Try again' : 'Attach my location'}
              icon="navigate-outline"
              loading={geo.state === 'busy'}
              onPress={attach}
              style={{ marginTop: 10 }}
              testID="check-in-attach-location"
            />
          </>
        )}
      </Card>

      <TextArea label="Notes" value={details} onChangeText={setDetails} placeholder="Facts only." testID="check-in-details" />
      {error ? <Callout tone="bad" style={{ marginTop: 4 }}>{error}</Callout> : null}
      <View style={{ height: t.spacing.sm }} />
    </Screen>
  );
}
