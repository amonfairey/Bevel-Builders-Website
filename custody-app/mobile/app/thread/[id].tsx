import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MESSAGES (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const detail = [id ? `id: ${id}` : null].filter(Boolean).join(' · ');
  return (
    <Screen headerTitle="Conversation" testID="placeholder-thread-id">
      <EmptyState icon="chatbubble-ellipses-outline" title="Coming soon" message={detail ? `Messages in this conversation, with read times and a tone-checked reply box.\n\n${detail}` : 'Messages in this conversation, with read times and a tone-checked reply box.'} />
    </Screen>
  );
}
