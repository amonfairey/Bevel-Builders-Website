import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: SCHEDULE (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function HolidayScreen() {
  return (
    <Screen headerTitle="Holiday or period" testID="placeholder-schedule-holiday">
      <EmptyState icon="gift-outline" title="Coming soon" message="Add a holiday or vacation period, fixed or alternating by year." />
    </Screen>
  );
}
