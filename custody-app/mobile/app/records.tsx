import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SETTINGS (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function RecordsScreen() {
  return (
    <Screen headerTitle="Records & reports" testID="placeholder-records">
      <EmptyState icon="document-text-outline" title="Coming soon" message="The court/attorney report, the integrity check, your journal and the activity log." />
    </Screen>
  );
}
