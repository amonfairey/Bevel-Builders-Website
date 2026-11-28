import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SCHEDULE (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function PrimaryScreen() {
  return (
    <Screen headerTitle="Primary parent" testID="placeholder-schedule-primary">
      <EmptyState icon="person-outline" title="Coming soon" message="Choose the primary (background) parent." />
    </Screen>
  );
}
