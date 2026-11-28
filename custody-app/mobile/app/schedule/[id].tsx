import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SCHEDULE (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function RuleScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const detail = [id ? `id: ${id}` : null].filter(Boolean).join(' · ');
  return (
    <Screen headerTitle="Schedule item" testID="placeholder-schedule-id">
      <EmptyState icon="document-text-outline" title="Coming soon" message={detail ? `Details, approval history, impact on time share and notes for this schedule item.\n\n${detail}` : 'Details, approval history, impact on time share and notes for this schedule item.'} />
    </Screen>
  );
}
