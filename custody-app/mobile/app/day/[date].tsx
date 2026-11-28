import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';
import { fmtDate, isDate } from '@/lib/format';

/**
 * PLACEHOLDER screen. Owner: HOME (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function DayScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const detail = [date ? `date: ${date}` : null].filter(Boolean).join(' · ');
  return (
    <Screen headerTitle={date && isDate(date) ? fmtDate(date) : 'Day'} testID="placeholder-day-date">
      <EmptyState icon="today-outline" title="Coming soon" message={detail ? `Custody segments, activities, synced events and notes for this day.\n\n${detail}` : 'Custody segments, activities, synced events and notes for this day.'} />
    </Screen>
  );
}
