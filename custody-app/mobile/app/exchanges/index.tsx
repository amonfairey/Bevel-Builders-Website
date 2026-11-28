import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SETTINGS (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function ExchangesScreen() {
  return (
    <Screen headerTitle="Exchanges" testID="placeholder-exchanges">
      <EmptyState icon="swap-horizontal-outline" title="Coming soon" message="Hand-off check-ins with server timestamps, lateness and optional GPS." />
    </Screen>
  );
}
