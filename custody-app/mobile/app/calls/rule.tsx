import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MESSAGES (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function CallRuleScreen() {
  return (
    <Screen headerTitle="Call schedule" testID="placeholder-calls-rule">
      <EmptyState icon="time-outline" title="Coming soon" message="Enter the calls your order allows (how many, how long, which days and times)." />
    </Screen>
  );
}
