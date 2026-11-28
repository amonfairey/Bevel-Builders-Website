import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SCHEDULE (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function PatternScreen() {
  return (
    <Screen headerTitle="Regular schedule" testID="placeholder-schedule-pattern">
      <EmptyState icon="repeat-outline" title="Coming soon" message="Set up alternating weekends, week on/week off, 2-2-3 and other repeating schedules." />
    </Screen>
  );
}
