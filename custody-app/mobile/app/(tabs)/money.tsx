import { EmptyState, Screen } from '@/components/ui';

/**
 * PLACEHOLDER screen. Owner: MONEY (built in a later run).
 * Replace the body; keep the default export and the route params.
 */
export default function MoneyScreen() {
  return (
    <Screen title="Money" testID="placeholder-money">
      <EmptyState icon="wallet-outline" title="Coming soon" message="Shared expenses with receipts, approvals, payments and the running balance." />
    </Screen>
  );
}
