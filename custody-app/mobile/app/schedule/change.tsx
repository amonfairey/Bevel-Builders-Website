import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SCHEDULE (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function ScheduleChangeScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const detail = [date ? `date: ${date}` : null].filter(Boolean).join(' · ');
  return (
    <Screen headerTitle="Request a change" testID="placeholder-schedule-change">
      <EmptyState icon="swap-horizontal-outline" title="Coming soon" message={detail ? `Request a one-time change or swap, with optional make-up time.\n\n${detail}` : 'Request a one-time change or swap, with optional make-up time.'} />
    </Screen>
  );
}
