import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SETTINGS (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function SyncScreen() {
  return (
    <Screen headerTitle="Calendar sync" testID="placeholder-sync">
      <EmptyState icon="sync-outline" title="Coming soon" message="Subscribe to the custody schedule in Apple, Google or Outlook calendars, and bring other calendars in." />
    </Screen>
  );
}
