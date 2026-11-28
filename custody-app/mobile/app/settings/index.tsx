import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SETTINGS (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function SettingsScreen() {
  return (
    <Screen headerTitle="Settings" testID="placeholder-settings">
      <EmptyState icon="settings-outline" title="Coming soon" message="Family, people and invite codes, children and their info, and your account." />
    </Screen>
  );
}
