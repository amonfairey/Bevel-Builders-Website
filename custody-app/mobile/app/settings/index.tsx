import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import {
  AppText, Badge, Button, Callout, Card, Field, ListGroup, ListItem, ParentDot, Screen, Section, useAttempt, useDialog,
} from '@/components/ui';
import { CopyRow } from '@/components/settings/CopyRow';
import { isDeletedEmail } from '@/components/settings/share';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { deviceTimeZone, fmtDate, isValidTimeZone } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import type { Me, Member, OkResponse } from '@/lib/types';

/**
 * Settings (web portal VIEWS.settings): family name / time zone / default split, people and
 * invite codes, children (each opens /settings/child/[id]), the account, and app info.
 * View-only members see everything read-only.
 */
export default function SettingsScreen() {
  const me = useMe();
  const { refreshMe } = useSession();
  const isParent = me.role === 'parent';
  const [refreshing, setRefreshing] = useState(false);

  // Codes and children may have changed on another device: refresh once on open.
  useEffect(() => { refreshMe().catch(() => undefined); }, [refreshMe]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refreshMe(); } catch { /* keep what we have */ } finally { setRefreshing(false); }
  };

  return (
    <Screen headerTitle="Settings" refreshing={refreshing} onRefresh={onRefresh} testID="settings-screen">
      {!isParent ? <Callout tone="warn" title="View-only access">You can see the family&apos;s records but not change them. You can still manage your own account and calendar sync.</Callout> : null}
      <FamilyForm me={me} />
      <People me={me} />
      <Children me={me} />

      <Section title="You">
        <ListGroup>
          <ListItem title="Account" subtitle={`${me.user.name} · ${me.user.email}`} icon="person-circle" onPress={() => router.push(routes.account as Href)} testID="settings-account" />
          <ListItem title="Calendar sync" icon="sync" iconColor="#2f6f9f" onPress={() => router.push(routes.sync as Href)} testID="settings-sync" />
        </ListGroup>
      </Section>

      <Section title="About">
        <ListGroup>
          <ListItem title="App version" right={`${Constants.expoConfig?.version ?? '?'}${Constants.expoConfig?.ios?.buildNumber ? ` (${Constants.expoConfig.ios.buildNumber})` : ''}`} />
          <ListItem title="Server" right={API_URL.replace(/^https?:\/\//, '')} />
        </ListGroup>
      </Section>
    </Screen>
  );
}

function FamilyForm({ me }: { me: Me }) {
  const t = useTheme();
  const attempt = useAttempt();
  const { refreshMe } = useSession();
  const f = me.family;
  const isParent = me.role === 'parent';
  const [name, setName] = useState(f.name);
  const [tz, setTz] = useState(f.timezone);
  const [split, setSplit] = useState(String(f.default_split));
  const [errors, setErrors] = useState<{ tz?: string; split?: string }>({});

  // Follow server-side changes (e.g. the other parent renamed the family) when nothing is being edited.
  const [base, setBase] = useState({ name: f.name, tz: f.timezone, split: f.default_split });
  if (base.name !== f.name || base.tz !== f.timezone || base.split !== f.default_split) {
    if (name === base.name) setName(f.name);
    if (tz === base.tz) setTz(f.timezone);
    if (split === String(base.split)) setSplit(String(f.default_split));
    setBase({ name: f.name, tz: f.timezone, split: f.default_split });
  }

  const save = async () => {
    const e: typeof errors = {};
    const zone = tz.trim();
    if (!isValidTimeZone(zone)) e.tz = 'Unknown time zone. Use a name like America/Los_Angeles.';
    const n = Number(split);
    if (split.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) e.split = 'Enter a number from 0 to 100';
    setErrors(e);
    if (e.tz || e.split) return;
    const ok = await attempt(() => api.put<OkResponse>('/api/family', { name: name.trim(), timezone: zone, default_split: Math.round(n) }), 'Family settings saved');
    if (ok) { try { await refreshMe(); } catch { /* saved; refresh later */ } }
  };

  const phoneTz = deviceTimeZone();
  // default_split is family-wide: the share the parent who paid an expense covers.
  const splitN = Number(split);
  const otherPct = split.trim() !== '' && Number.isFinite(splitN) && splitN >= 0 && splitN <= 100 ? `${100 - Math.round(splitN)}%` : '100 minus this';
  const splitHint = `Same for both parents: whoever pays an expense covers this share. New expenses start the other parent's share at ${otherPct}.`;
  const readOnly = isParent ? undefined : { backgroundColor: t.colors.soft };
  return (
    <Section title="Family">
      <Card>
        <Field label="Family name" value={name} onChangeText={setName} editable={isParent} inputStyle={readOnly} autoCapitalize="words" testID="family-name" />
        <Field
          label="Time zone"
          value={tz}
          onChangeText={(v) => { setTz(v); if (errors.tz) setErrors((x) => ({ ...x, tz: undefined })); }}
          editable={isParent}
          inputStyle={readOnly}
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.tz}
          hint="All schedule times use this zone, wherever you are."
          testID="family-timezone"
        />
        {isParent && phoneTz !== tz.trim() ? (
          <Button title={`Use this phone's zone (${phoneTz})`} variant="link" size="sm" onPress={() => setTz(phoneTz)} style={{ marginTop: -10, marginBottom: 12 }} />
        ) : null}
        {isParent ? <Field
          label="Default expense split: paying parent's share (%)"
          value={split}
          onChangeText={(v) => { setSplit(v.replace(/[^0-9]/g, '')); if (errors.split) setErrors((x) => ({ ...x, split: undefined })); }}
          keyboardType="number-pad"
          maxLength={3}
          error={errors.split}
          hint={splitHint}
          testID="family-split"
        /> : null}
        {isParent ? <Button title="Save" variant="primary" onPress={save} testID="family-save" /> : null}
      </Card>
    </Section>
  );
}

function People({ me }: { me: Me }) {
  const attempt = useAttempt();
  const dialog = useDialog();
  const { refreshMe } = useSession();
  const f = me.family;
  const isParent = me.role === 'parent';

  // Parents can remove a view-only member (e.g. an attorney whose engagement ended). Parents cannot be removed.
  const removeViewer = async (m: Member) => {
    const ok = await dialog.confirm({
      title: `Remove ${m.name}?`,
      message: `${m.name} loses view-only access to your family's calendar and records. Your co-parent is told. To stop them rejoining, also make a new view-only code.`,
      okLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    const r = await attempt(() => api.post<OkResponse>(`/api/members/${m.id}/remove`), `${m.name} removed`);
    if (r) { try { await refreshMe(); } catch { /* shown on next refresh */ } }
  };

  const newViewerCode = async () => {
    const ok = await dialog.confirm({
      title: 'Make a new view-only code?',
      message: 'The current code stops working. People who already joined keep their access.',
      okLabel: 'Make a new code',
    });
    if (!ok) return;
    const r = await attempt(() => api.post<{ viewer_code: string }>('/api/family/viewer-code'), 'New code created; the old one no longer works');
    if (r) { try { await refreshMe(); } catch { /* shown on next refresh */ } }
  };

  return (
    <Section title="People">
      <ListGroup>
        {me.members.map((m) => {
          const deleted = isDeletedEmail(m.email);
          const role = m.role === 'viewer' ? 'View only' : 'Parent';
          return (
            <ListItem
              key={m.id}
              title={`${deleted ? 'Deleted user' : m.name}${m.id === me.user.id ? ' (you)' : ''}`}
              subtitle={deleted ? `${role} · account deleted; past records are kept` : `${role} · ${m.email}`}
              left={<ParentDot id={m.id} size={12} />}
              right={m.role === 'viewer' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Badge label="View only" tone="warn" />
                  {isParent ? (
                    <Button title="Remove" variant="danger" size="sm" onPress={() => { void removeViewer(m); }}
                      accessibilityLabel={`Remove ${m.name}`} testID={`member-${m.id}-remove`} />
                  ) : null}
                </View>
              ) : undefined}
              testID={`member-${m.id}`}
            />
          );
        })}
      </ListGroup>
      {isParent && f.invite_code ? (
        <Card>
          <AppText variant="subhead" weight="600" style={{ marginBottom: 8 }}>Invite your co-parent</AppText>
          <CopyRow
            value={f.invite_code}
            big
            hint="They create an account in CoParent Hub, then enter this code. It works once."
            shareTitle="CoParent Hub invite"
            shareMessage={`Join our family "${f.name}" on CoParent Hub: create an account, choose "Join with a code" and enter ${f.invite_code}`}
            testID="invite-code"
          />
        </Card>
      ) : null}
      {isParent && f.viewer_code ? (
        <Card>
          <AppText variant="subhead" weight="600" style={{ marginBottom: 2 }}>View-only code</AppText>
          <AppText variant="footnote" tone="muted" style={{ marginBottom: 8 }}>For an attorney, mediator, guardian ad litem or step-parent. They can see the calendar and records but cannot change anything.</AppText>
          <CopyRow
            value={f.viewer_code}
            big
            shareTitle="CoParent Hub view-only access"
            shareMessage={`View-only access to "${f.name}" on CoParent Hub: create an account, choose "Join with a code" and enter ${f.viewer_code}`}
            testID="viewer-code"
          >
            <Button title="Make a new code" icon="refresh" size="sm" onPress={newViewerCode} testID="viewer-code-rotate" />
          </CopyRow>
        </Card>
      ) : null}
    </Section>
  );
}

function Children({ me }: { me: Me }) {
  const isParent = me.role === 'parent';
  return (
    <Section
      title="Children & info"
      action={isParent ? <Button title="+ Child" variant="link" onPress={() => router.push(routes.child('new') as Href)} testID="add-child" /> : undefined}
      footer="Shared info both parents can see: school, doctors, allergies, sizes. Changes are logged."
    >
      {me.children.length === 0 ? (
        <AppText tone="muted">{isParent ? 'No children added yet. Tap "+ Child".' : 'No children added yet.'}</AppText>
      ) : (
        <ListGroup>
          {me.children.map((c) => {
            const filled = Object.values(c.info || {}).filter((v) => v && String(v).trim()).length;
            const sub = [c.birthdate ? `Born ${fmtDate(c.birthdate)}` : null, filled ? `${filled} info ${filled === 1 ? 'field' : 'fields'}` : 'No info yet'].filter(Boolean).join(' · ');
            return <ListItem key={c.id} title={c.name} subtitle={sub} icon="happy-outline" iconColor="#2e8a6a" onPress={() => router.push(routes.child(c.id) as Href)} testID={`child-${c.id}`} />;
          })}
        </ListGroup>
      )}
    </Section>
  );
}

