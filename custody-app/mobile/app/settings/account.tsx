import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Callout, Card, Checkbox, Field, ListGroup, ListItem, Screen, Section, useDialog, useToast } from '@/components/ui';
import { isDeletedEmail } from '@/components/settings/share';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import type { Me, OkResponse } from '@/lib/types';

/**
 * Your account (web portal accountCard): change password, sign out, and delete the account
 * (App Store Review Guideline 5.1.1(v)). Available to parents and view-only members.
 */
export default function AccountScreen() {
  const me = useMe();
  const dialog = useDialog();
  const { signOut } = useSession();

  const confirmSignOut = async () => {
    const ok = await dialog.confirm({ title: 'Sign out?', message: 'You will stop getting notifications on this device until you sign in again.', okLabel: 'Sign out', destructive: true });
    if (ok) await signOut();
  };

  return (
    <Screen headerTitle="Account" testID="account-screen">
      <Section title="Signed in as">
        <ListGroup>
          <ListItem title={me.user.name} subtitle={me.user.email} icon="person-circle" />
        </ListGroup>
      </Section>
      <ChangePassword />
      <Section>
        <ListGroup>
          <ListItem title="Sign out" icon="log-out-outline" destructive chevron={false} onPress={confirmSignOut} testID="account-sign-out" />
        </ListGroup>
      </Section>
      <DeleteAccount me={me} />
    </Screen>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!current) return setError('Enter your current password.');
    if (next.length < 10) return setError('The new password must be at least 10 characters.');
    if (next !== confirm) return setError('The new passwords don’t match.');
    try {
      await api.post<OkResponse>('/api/account/password', { current, next });
      setCurrent(''); setNext(''); setConfirm('');
      toast.show('Password changed. Your other devices were signed out.', { tone: 'ok' });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Section title="Change password" footer="Changing it signs you out on every other device, including the web portal.">
      <Card>
        <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" autoCapitalize="none" testID="pw-current" />
        <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" hint="At least 10 characters." testID="pw-next" />
        <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" autoCapitalize="none" returnKeyType="go" onSubmitEditing={submit} testID="pw-confirm" />
        {error ? <Callout tone="bad">{error}</Callout> : null}
        <Button title="Change password" variant="primary" onPress={submit} testID="pw-submit" />
      </Card>
    </Section>
  );
}

function DeleteAccount({ me }: { me: Me }) {
  const t = useTheme();
  const dialog = useDialog();
  const toast = useToast();
  const { signOutLocally } = useSession();
  const [password, setPassword] = useState('');
  const [understand, setUnderstand] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const others = me.members.filter((m) => m.id !== me.user.id && !isDeletedEmail(m.email));
  const names = others.map((m) => m.name).join(' and ');
  const forYou = others.length
    ? `${names} ${others.length > 1 ? 'remain' : 'remains'} in your family, so your account will be anonymized rather than erased.${me.role === 'viewer' ? ' Your view-only access ends; the family’s records are not changed.' : ' Your past messages, notes and approvals stay in the shared record as “Deleted user”.'}`
    : 'You are the only member of your family, so everything will be permanently deleted: the whole family space and all its records.';

  const submit = async () => {
    setError(null);
    if (!password) return setError('Enter your password.');
    if (!understand) return setError('Tick the box to confirm you understand.');
    const ok = await dialog.confirm({
      title: 'Delete your account?',
      message: others.length
        ? 'Your login and personal details are removed now. You will be signed out and cannot sign in again with this account.'
        : 'Your account and the whole family space are erased now. This cannot be undone.',
      okLabel: 'Delete my account',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.post<OkResponse>('/api/account/delete', { password });
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    // The server has already removed this device's sessions and push token: just forget them here.
    await signOutLocally();
    toast.show('Your account was deleted.', { tone: 'ok' });
  };

  return (
    <Section title="Delete my account">
      <Card tone="bad" testID="delete-account">
        <AppText variant="subhead" style={{ marginBottom: 8 }}>What happens:</AppText>
        <View style={{ gap: 6, marginBottom: 10 }}>
          <AppText variant="subhead">
            <AppText variant="subhead" weight="600">If you are the only member: </AppText>
            your account and the whole family space (schedule, messages, notes, expenses, files and the activity log) are permanently deleted. This cannot be undone.
          </AppText>
          <AppText variant="subhead">
            <AppText variant="subhead" weight="600">If a co-parent or view-only member remains: </AppText>
            your login and personal details (name, email, password, calendar link, devices) are removed. Messages, notes and approvals you took part in stay in the shared record as “Deleted user”, because they are the other parent’s records too.
          </AppText>
        </View>
        <Callout tone="warn" title="For you">{forYou}</Callout>
        <Field label="Your password" value={password} onChangeText={(v) => { setPassword(v); if (error) setError(null); }} secureTextEntry autoComplete="current-password" textContentType="password" autoCapitalize="none" testID="delete-password" />
        <Checkbox label="I understand this cannot be undone." value={understand} onChange={setUnderstand} testID="delete-understand" />
        {error ? <Callout tone="bad">{error}</Callout> : null}
        <Button title="Permanently delete my account" icon="trash-outline" variant="danger" block onPress={submit} style={{ borderColor: t.colors.bad }} testID="delete-submit" />
      </Card>
    </Section>
  );
}
