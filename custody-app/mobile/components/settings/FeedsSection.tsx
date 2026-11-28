import { useState } from 'react';
import { View } from 'react-native';
import {
  AppText, AsyncView, Badge, Button, ButtonRow, Callout, Card, Field, Row, Section, Select, useAttempt, useDialog, useToast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtIso } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import type { Feed, FeedProvider, FeedSyncResult, OkResponse } from '@/lib/types';

const PROVIDERS: { value: FeedProvider; label: string }[] = [
  { value: 'google', label: 'Google' },
  { value: 'apple', label: 'Apple iCloud' },
  { value: 'outlook', label: 'Outlook / Microsoft 365' },
  { value: 'other', label: 'Other' },
];
const PROVIDER_LABEL: Record<string, string> = Object.fromEntries(PROVIDERS.map((p) => [p.value, p.label]));

function Bullet({ head, children }: { head: string; children: string }) {
  return (
    <AppText variant="footnote" style={{ marginBottom: 4 }}>
      <AppText variant="footnote" weight="600">{`${head}: `}</AppText>
      {children}
    </AppText>
  );
}

/** "Bring your other calendars in": connected calendars (sync now / remove) and the add form. */
export function FeedsSection() {
  const { tz, myId, nameOf } = usePeople();
  const toast = useToast();
  const attempt = useAttempt();
  const dialog = useDialog();
  const q = useApi<Feed[]>('/api/feeds');
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<FeedProvider>('google');
  const [visibility, setVisibility] = useState<'me' | 'family'>('me');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    if (!url.trim()) { setError('Paste the calendar\'s secret iCal address'); return; }
    try {
      const r = await api.post<FeedSyncResult>('/api/feeds', { name: name.trim(), provider, visibility, url: url.trim() });
      toast.show(r.ok ? `Added, ${r.count ?? 0} events` : `Added, but sync failed: ${r.error ?? 'unknown error'}`, { tone: r.ok ? 'ok' : 'bad' });
      setName(''); setUrl('');
      await q.reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const syncNow = async (f: Feed) => {
    const r = await attempt(() => api.post<FeedSyncResult>(`/api/feeds/${f.id}/sync`));
    if (r) toast.show(r.ok ? `Synced ${r.count ?? 0} events` : r.error ?? 'Sync failed', { tone: r.ok ? 'ok' : 'bad' });
    await q.reload();
  };

  const remove = async (f: Feed) => {
    const ok = await dialog.confirm({ title: 'Remove calendar?', message: `"${f.name}" and its imported events will be removed from CoParent Hub. Your original calendar is not changed.`, okLabel: 'Remove', destructive: true });
    if (!ok) return;
    if (await attempt(() => api.del<OkResponse>(`/api/feeds/${f.id}`), 'Calendar removed')) await q.reload();
  };

  return (
    <>
      <Section title="Connected calendars">
        <AsyncView state={q}>
          {(feeds) => feeds.length === 0 ? <AppText tone="muted">None yet.</AppText> : (
            <View testID="feeds-list">
              {feeds.map((f) => (
                <Card key={f.id} tone={f.last_error ? 'bad' : undefined}>
                  <Row justify="space-between">
                    <AppText variant="headline" style={{ flex: 1 }} numberOfLines={2}>{f.name}</AppText>
                    <Badge label={PROVIDER_LABEL[f.provider] ?? f.provider} />
                  </Row>
                  <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>
                    {`${f.events} events · ${f.visibility === 'family' ? 'shared with co-parent' : 'only you'} · last sync ${f.last_sync ? fmtIso(f.last_sync, tz) : 'never'}`}
                    {f.user_id !== myId ? ` · added by ${nameOf(f.user_id)}` : ''}
                  </AppText>
                  {f.last_error ? <AppText variant="footnote" tone="bad" style={{ marginTop: 4 }}>{f.last_error}</AppText> : null}
                  {f.user_id === myId ? (
                    <ButtonRow>
                      <Button title="Sync now" icon="refresh" size="sm" onPress={() => syncNow(f)} />
                      <Button title="Remove" size="sm" variant="danger" onPress={() => remove(f)} />
                    </ButtonRow>
                  ) : null}
                </Card>
              ))}
            </View>
          )}
        </AsyncView>
      </Section>

      <Section title="Add a calendar">
        <Card>
          <AppText variant="subhead" tone="muted" style={{ marginBottom: 10 }}>
            Shows those events on the calendar here (read-only) so you can spot conflicts. Paste the calendar&apos;s secret iCal address:
          </AppText>
          <Bullet head="Google">Settings → pick the calendar → Integrate calendar → &quot;Secret address in iCal format&quot;.</Bullet>
          <Bullet head="Apple iCloud">Calendar app → Calendars → tap ⓘ next to the calendar → Public Calendar → Share Link → Copy.</Bullet>
          <Bullet head="Outlook">Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.</Bullet>
          <Bullet head="TeamSnap, school sites, etc.">look for &quot;Subscribe&quot; or &quot;iCal/ICS&quot;.</Bullet>
          <View style={{ height: 12 }} />
          <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. My work calendar" testID="feed-name" />
          <Select<FeedProvider> label="Provider" value={provider} options={PROVIDERS} onChange={setProvider} testID="feed-provider" />
          <Select<'me' | 'family'>
            label="Who can see it"
            value={visibility}
            options={[{ value: 'me', label: 'Only me' }, { value: 'family', label: 'Me and co-parent' }]}
            onChange={setVisibility}
            testID="feed-visibility"
          />
          <Field
            label="Secret iCal (.ics) address"
            value={url}
            onChangeText={(v) => { setUrl(v); if (error) setError(null); }}
            placeholder="https://… or webcal://…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="feed-url"
          />
          {error ? <Callout tone="bad">{error}</Callout> : null}
          <Button title="Add calendar" variant="primary" icon="add" onPress={add} testID="feed-add" />
        </Card>
      </Section>
    </>
  );
}
