import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SCHEDULE (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function ScheduleScreen() {
  return (
    <Screen headerTitle="Custody schedule" testID="placeholder-schedule">
      <EmptyState icon="git-compare-outline" title="Coming soon" message="Primary parent, regular schedule, holidays and one-time changes, with approvals and time share." />
    </Screen>
  );
}
