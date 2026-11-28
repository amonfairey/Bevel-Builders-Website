import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MONEY (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function ActivitiesScreen() {
  return (
    <Screen headerTitle="Activities" testID="placeholder-activities">
      <EmptyState icon="football-outline" title="Coming soon" message="Sports, lessons, school events and appointments for the next 90 days." />
    </Screen>
  );
}
