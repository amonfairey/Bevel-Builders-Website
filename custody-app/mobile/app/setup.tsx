import { useState } from 'react';
import { View } from 'react-native';
import {
  AppText, Button, Callout, Card, DateField, Field, IconButton, Row, Screen, Section, Segmented,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { deviceTimeZone, isValidTimeZone } from '@/lib/format';
import { useSession } from '@/lib/session';

type Mode = 'create' | 'join';
interface KidRow { key: number; name: string; birthdate: string }

/**
 * First run after sign-up: start a family space (name, time zone, children) or join one
 * with an invite code. Same fields and wording as the web portal's setup screen.
 */
export default function Setup() {
  const { me, refreshMe, signOut } = useSession();
  const [mode, setMode] = useState<Mode>('create');

  return (
    <Screen title={`Welcome, ${me?.user.name ?? ''}`.trim()} subtitle="Set up your family space, or join the one your co-parent created." testID="setup-screen">
      <Segmented<Mode>
        options={[{ value: 'create', label: 'Start a family' }, { value: 'join', label: 'Join with a code' }]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'create' ? <CreateFamily onDone={refreshMe} /> : <JoinFamily onDone={refreshMe} />}
      <Button title="Sign out" variant="link" onPress={signOut} style={{ alignSelf: 'center', marginTop: 8 }} />
    </Screen>
  );
}

function CreateFamily({ onDone }: { onDone: () => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [tz, setTz] = useState(deviceTimeZone());
  const [kids, setKids] = useState<KidRow[]>([{ key: 1, name: '', birthdate: '' }]);
  const [tzError, setTzError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (key: number, patch: Partial<KidRow>) => setKids((ks) => ks.map((k) => (k.key === key ? { ...k, ...patch } : k)));
  const addKid = () => setKids((ks) => [...ks, { key: Math.max(0, ...ks.map((k) => k.key)) + 1, name: '', birthdate: '' }]);
  const removeKid = (key: number) => setKids((ks) => (ks.length > 1 ? ks.filter((k) => k.key !== key) : [{ key: 1, name: '', birthdate: '' }]));

  const submit = async () => {
    setError(null);
    const zone = tz.trim();
    if (!isValidTimeZone(zone)) { setTzError('Unknown time zone'); return; }
    try {
      await api.post('/api/family', {
        name: name.trim(),
        timezone: zone,
        children: kids.filter((k) => k.name.trim()).map((k) => ({ name: k.name.trim(), birthdate: k.birthdate || undefined })),
      });
      await onDone(); // the auth gate moves on to the tabs
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <View>
      <AppText variant="subhead" tone="muted" style={{ marginBottom: 16 }}>
        You will get an invite code for your co-parent. You start as the primary (default) parent; your co-parent confirms or disputes that when they join.
      </AppText>
      <Field label="Family name" value={name} onChangeText={setName} placeholder="e.g. The Smith kids" autoCapitalize="words" testID="family-name" />
      <Field
        label="Time zone"
        value={tz}
        onChangeText={(v) => { setTz(v); if (tzError) setTzError(null); }}
        error={tzError}
        hint="All schedule times use this zone. Defaults to this phone's zone."
        autoCapitalize="none"
        autoCorrect={false}
        testID="family-timezone"
      />
      <Section title="Children">
        {kids.map((k, i) => (
          <Card key={k.key} padded style={{ paddingBottom: 0 }}>
            <Row justify="space-between" style={{ minHeight: 32, marginTop: -8, marginBottom: 4 }}>
              <AppText variant="subhead" weight="600">{`Child ${i + 1}`}</AppText>
              {kids.length > 1 ? <IconButton icon="trash-outline" accessibilityLabel={`Remove child ${i + 1}`} onPress={() => removeKid(k.key)} size={18} /> : null}
            </Row>
            <Field label="Name" value={k.name} onChangeText={(v) => update(k.key, { name: v })} autoCapitalize="words" testID={`kid-name-${i}`} />
            <DateField label="Birthdate" value={k.birthdate} onChange={(v) => update(k.key, { birthdate: v })} optional testID={`kid-birthdate-${i}`} />
          </Card>
        ))}
        <Button title="Another child" icon="add" onPress={addKid} size="sm" testID="add-kid" />
      </Section>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <Button title="Create" variant="primary" block onPress={submit} testID="create-family" />
    </View>
  );
}

function JoinFamily({ onDone }: { onDone: () => Promise<unknown> }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (!code.trim()) { setError('Enter the invite code'); return; }
    try {
      await api.post('/api/family/join', { code: code.trim().toUpperCase() });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <View>
      <AppText variant="subhead" tone="muted" style={{ marginBottom: 16 }}>
        Co-parents, attorneys, mediators or step-parents (view-only) use a code from the other parent.
      </AppText>
      <Field
        label="Invite code"
        value={code}
        onChangeText={(v) => { setCode(v.toUpperCase()); if (error) setError(null); }}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="e.g. 3F9A1C0B7D"
        returnKeyType="go"
        onSubmitEditing={submit}
        testID="invite-code"
      />
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <Button title="Join" variant="primary" block onPress={submit} testID="join-family" />
    </View>
  );
}
