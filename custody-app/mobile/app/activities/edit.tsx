import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MONEY (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function EditActivityScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const detail = [id ? `id: ${id}` : null].filter(Boolean).join(' · ');
  return (
    <Screen headerTitle={id ? 'Edit activity' : 'Add activity'} testID="placeholder-activities-edit">
      <EmptyState icon="create-outline" title="Coming soon" message={detail ? `Add or edit an activity: time, repeats, location, driver and cost.\n\n${detail}` : 'Add or edit an activity: time, repeats, location, driver and cost.'} />
    </Screen>
  );
}
