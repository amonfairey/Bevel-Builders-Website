import { router, type Href } from 'expo-router';
import { AppText, AsyncView, Button, EmptyState, Screen } from '@/components/ui';
import { ExchangeCard } from '@/components/exchanges/ExchangeCard';
import { useApi, usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { Exchange } from '@/lib/types';

/**
 * Exchange check-ins (web portal VIEWS.exchanges): the server timestamps each check-in and
 * compares it with the scheduled hand-off. Parents get a big "Check in now" button.
 */
export default function ExchangesScreen() {
  const { isParent } = usePeople();
  const q = useApi<Exchange[]>('/api/exchanges');
  const checkIn = () => router.push(routes.checkIn as Href);

  return (
    <Screen headerTitle="Exchanges" refreshing={q.refreshing} onRefresh={q.refresh} testID="exchanges-screen">
      <AppText variant="subhead" tone="muted" style={{ marginBottom: 12 }}>
        Check in at hand-offs. The server timestamps each check-in and compares it with the scheduled exchange. A check-in saved more than 10 minutes after the time entered is marked "Entered later".
      </AppText>
      {isParent ? (
        <Button title="Check in now" icon="location" variant="primary" block onPress={checkIn} style={{ minHeight: 56, marginBottom: 20 }} testID="check-in-now" />
      ) : null}
      <AsyncView state={q}>
        {(list) => list.length === 0 ? (
          <EmptyState
            icon="swap-horizontal-outline"
            title="No check-ins yet"
            message={isParent ? 'Tap "Check in now" when you drop off or pick up the children.' : 'Check-ins by either parent will show up here.'}
          />
        ) : (
          <>{list.map((x) => <ExchangeCard key={x.id} x={x} />)}</>
        )}
      </AsyncView>
    </Screen>
  );
}
