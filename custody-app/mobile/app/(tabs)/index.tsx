import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: HOME (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function HomeScreen() {
  return (
    <Screen title="Home" testID="placeholder-home">
      <EmptyState icon="home-outline" title="Coming soon" message="Who has the kids now, the next exchange, decisions waiting on you, time share and the next 14 days." />
    </Screen>
  );
}
