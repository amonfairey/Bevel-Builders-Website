import { router, type Href } from 'expo-router';
import { AppText, AsyncView, Button, EmptyState, ListGroup, ListItem, Screen } from '@/components/ui';
import { fmtListTime, topicIcon, topicLabel } from '@/components/messages/format';
import { routes } from '@/lib/links';
import { useApi, usePeople } from '@/lib/hooks';
import type { Thread } from '@/lib/types';

/**
 * Messages tab: every conversation in the family, newest activity first, with its topic,
 * message count, last activity and an unread count. Parents can start a new one.
 */
export default function MessagesScreen() {
  const { tz, isParent } = usePeople();
  const q = useApi<Thread[]>('/api/threads');
  const newThread = () => router.push(routes.newThread as Href);

  return (
    <Screen
      title="Messages"
      subtitle="A neutral, permanent record. Each message gets a tone check before it's sent."
      titleRight={isParent ? <Button title="New" icon="create-outline" variant="primary" size="sm" onPress={newThread} testID="new-thread" /> : undefined}
      refreshing={q.refreshing}
      onRefresh={q.refresh}
      testID="messages-screen"
    >
      <AsyncView state={q}>
        {(threads) => threads.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title="No conversations yet"
            message={isParent
              ? 'Start one per topic (spring break dates, a school form, a doctor visit). One topic per conversation keeps the record clear.'
              : 'Conversations between the parents will appear here.'}
            actionLabel={isParent ? 'Start a conversation' : undefined}
            onAction={isParent ? newThread : undefined}
          />
        ) : (
          <>
            <ListGroup>
              {threads.map((th) => {
                const count = th.count ?? 0;
                return (
                  <ListItem
                    key={th.id}
                    icon={topicIcon(th.topic)}
                    title={th.subject}
                    subtitle={`${topicLabel(th.topic)} · ${count} message${count === 1 ? '' : 's'}`}
                    right={fmtListTime(th.last_at ?? th.created_at, tz)}
                    // viewers never record reads, so their server-side unread count never clears
                    badge={isParent ? th.unread ?? 0 : 0}
                    onPress={() => router.push(routes.thread(th.id) as Href)}
                    testID={`thread-row-${th.id}`}
                  />
                );
              })}
            </ListGroup>
            <AppText variant="footnote" tone="muted" style={{ marginHorizontal: 4 }}>
              Messages can't be edited or deleted, and read times are recorded.
            </AppText>
          </>
        )}
      </AsyncView>
    </Screen>
  );
}
