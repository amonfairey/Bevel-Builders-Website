import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MONEY (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function NewPaymentScreen() {
  return (
    <Screen headerTitle="Record a payment" testID="placeholder-payment-new">
      <EmptyState icon="cash-outline" title="Coming soon" message="Record a payment you sent; your co-parent confirms they received it." />
    </Screen>
  );
}
