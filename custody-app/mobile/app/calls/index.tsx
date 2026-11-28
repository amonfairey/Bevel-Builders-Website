import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MESSAGES (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function CallsScreen() {
  return (
    <Screen headerTitle="Calls & video" testID="placeholder-calls">
      <EmptyState icon="videocam-outline" title="Coming soon" message="Court-ordered call schedules, the call log and compliance for the last 4 weeks." />
    </Screen>
  );
}
