import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SETTINGS (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function CheckInScreen() {
  return (
    <Screen headerTitle="Exchange check-in" testID="placeholder-exchanges-check-in">
      <EmptyState icon="location-outline" title="Coming soon" message="One-tap check-in at a hand-off, with optional location." />
    </Screen>
  );
}
