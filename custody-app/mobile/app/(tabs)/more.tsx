import Constants from 'expo-constants';
import { router, type Href } from 'expo-router';
import { AppText, Badge, ListGroup, ListItem, ParentDot, Row, Screen, Section, useDialog } from '@/components/ui';
import { useBadges } from '@/lib/badges';
import { API_URL } from '@/lib/config';
import { useMe } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

/** Everything that is not a tab: the rest of the web portal's sidebar, plus sign out. */
export default function More() {
  const me = useMe();
  const t = useTheme();
  const { signOut } = useSession();
  const { unreadNotifications, pending } = useBadges();
  const dialog = useDialog();
  const go = (href: string) => () => router.push(href as Href);

  const confirmSignOut = async () => {
    const ok = await dialog.confirm({ title: 'Sign out?', message: 'You will stop getting notifications on this device until you sign in again.', okLabel: 'Sign out', destructive: true });
    if (ok) await signOut();
  };

  return (
    <Screen title="More" testID="more-screen">
      <Row style={{ marginBottom: t.spacing.lg }} gap={10}>
        <ParentDot id={me.user.id} size={12} />
        <AppText variant="headline">{me.user.name}</AppText>
        <AppText tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{me.family.name}</AppText>
        {me.role === 'viewer' ? <Badge label="View only" tone="warn" /> : null}
      </Row>

      <Section title="Family">
        <ListGroup>
          <ListItem title="Custody schedule" icon="git-compare" onPress={go(routes.schedule)} badge={pending?.rules} testID="more-schedule" />
          <ListItem title="Activities" icon="football" iconColor="#2e8a6a" onPress={go(routes.activities)} badge={pending?.events} testID="more-activities" />
          <ListItem title="Calls & video" icon="videocam" iconColor="#6b5ea8" onPress={go(routes.calls)} badge={(pending?.call_rules ?? 0) + (pending?.calls ?? 0)} testID="more-calls" />
          <ListItem title="Exchanges" icon="swap-horizontal" iconColor="#b4572e" onPress={go(routes.exchanges)} testID="more-exchanges" />
        </ListGroup>
      </Section>

      <Section title="Updates & records">
        <ListGroup>
          <ListItem title="Notifications" icon="notifications" iconColor="#b33a3a" onPress={go(routes.notifications)} badge={unreadNotifications} testID="more-notifications" />
          <ListItem title="Records & reports" icon="document-text" iconColor="#5d676e" onPress={go(routes.records)} testID="more-records" />
          <ListItem title="Calendar sync" icon="sync" iconColor="#2f6f9f" onPress={go(routes.sync)} testID="more-sync" />
        </ListGroup>
      </Section>

      <Section>
        <ListGroup>
          <ListItem title="Settings" icon="settings" iconColor="#5d676e" onPress={go(routes.settings)} testID="more-settings" />
          <ListItem title="Sign out" icon="log-out-outline" destructive onPress={confirmSignOut} chevron={false} testID="more-sign-out" />
        </ListGroup>
      </Section>

      <AppText variant="caption" tone="muted" align="center">
        {`CoParent Hub ${Constants.expoConfig?.version ?? ''} · ${API_URL.replace(/^https?:\/\//, '')}`}
      </AppText>
    </Screen>
  );
}
