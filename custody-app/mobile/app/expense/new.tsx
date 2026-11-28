import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MONEY (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function NewExpenseScreen() {
  const { eventId, description, amount } = useLocalSearchParams<{ eventId?: string; description?: string; amount?: string }>();
  const detail = [eventId ? `eventId: ${eventId}` : null, description ? `description: ${description}` : null, amount ? `amount: ${amount}` : null].filter(Boolean).join(' · ');
  return (
    <Screen headerTitle="Add expense" testID="placeholder-expense-new">
      <EmptyState icon="receipt-outline" title="Coming soon" message={detail ? `Log a shared cost with a receipt photo and ask for reimbursement.\n\n${detail}` : 'Log a shared cost with a receipt photo and ask for reimbursement.'} />
    </Screen>
  );
}
