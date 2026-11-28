import { useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MONEY (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const detail = [id ? `id: ${id}` : null].filter(Boolean).join(' · ');
  return (
    <Screen headerTitle="Expense" testID="placeholder-expense-id">
      <EmptyState icon="receipt-outline" title="Coming soon" message={detail ? `Expense details, receipt, approval and notes.\n\n${detail}` : 'Expense details, receipt, approval and notes.'} />
    </Screen>
  );
}
