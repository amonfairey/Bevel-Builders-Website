import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MESSAGES (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function NewThreadScreen() {
  return (
    <Screen headerTitle="New conversation" testID="placeholder-thread-new">
      <EmptyState icon="create-outline" title="Coming soon" message="Start a conversation with a subject and topic." />
    </Screen>
  );
}
