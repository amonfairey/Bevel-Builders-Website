import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MESSAGES (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function MessagesScreen() {
  return (
    <Screen title="Messages" testID="placeholder-messages">
      <EmptyState icon="chatbubbles-outline" title="Coming soon" message="Tone-checked conversations by topic, with read receipts. Messages can't be edited or deleted." />
    </Screen>
  );
}
