import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: HOME (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function CalendarScreen() {
  return (
    <Screen title="Calendar" testID="placeholder-calendar">
      <EmptyState icon="calendar-outline" title="Coming soon" message="A month view colored by who has the children, with activities and your synced calendars." />
    </Screen>
  );
}
