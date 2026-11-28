import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MESSAGES (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function LogCallScreen() {
  return (
    <Screen headerTitle="Log a call" testID="placeholder-calls-log">
      <EmptyState icon="call-outline" title="Coming soon" message="Record what happened with a scheduled or actual call." />
    </Screen>
  );
}
