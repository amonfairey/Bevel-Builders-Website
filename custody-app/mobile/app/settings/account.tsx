import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SETTINGS (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function AccountScreen() {
  return (
    <Screen headerTitle="Account" testID="placeholder-settings-account">
      <EmptyState icon="person-circle-outline" title="Coming soon" message="Change your password or delete your account." />
    </Screen>
  );
}
