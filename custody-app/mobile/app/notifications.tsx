import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: HOME (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function NotificationsScreen() {
  return (
    <Screen headerTitle="Notifications" testID="placeholder-notifications">
      <EmptyState icon="notifications-outline" title="Coming soon" message="Your inbox of approvals, messages, payments and exchange reminders." />
    </Screen>
  );
}
