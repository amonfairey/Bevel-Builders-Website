import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SETTINGS (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function ChildScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const detail = [id ? `id: ${id}` : null].filter(Boolean).join(' · ');
  return (
    <Screen headerTitle="Child" testID="placeholder-settings-child-id">
      <EmptyState icon="happy-outline" title="Coming soon" message={detail ? `School, doctor, allergies, sizes and emergency contact for this child.\n\n${detail}` : 'School, doctor, allergies, sizes and emergency contact for this child.'} />
    </Screen>
  );
}
