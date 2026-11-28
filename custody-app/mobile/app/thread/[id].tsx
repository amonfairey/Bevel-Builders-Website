import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Badge, Callout, ErrorView, Loading, useAttempt, useToneGate, type TextInputRef } from '@/components/ui';
import { Composer } from '@/components/messages/Composer';
import { DaySeparator, MessageBubble } from '@/components/messages/MessageBubble';
import { isoDay, topicLabel } from '@/components/messages/format';
import { api } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { fmtDate, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import type { IdResponse, ThreadReadResponse, ThreadResponse } from '@/lib/types';

const POLL_MS = 15000;

/**
 * One conversation. Loading it (GET /api/threads/:id) records nothing; while the screen is
 * focused, POST /api/threads/:id/read records read receipts for the co-parent's messages on
 * screen (after the first load and whenever a poll brings new ones). Refreshes on focus and
 * every 15 s while open, scrolls to the newest message, and tone-checks every reply before sending.
 */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const threadId = id && /^\d+$/.test(id) ? id : null;
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const { myId, tz, isParent } = usePeople();
  const badges = useBadges();
  const toneGate = useToneGate();
  const attempt = useAttempt();
  const q = useApi<ThreadResponse>(threadId ? `/api/threads/${threadId}` : null);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInputRef>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const nearBottom = useRef(true);
  const forceScroll = useRef(true);
  const firstScroll = useRef(true);

  const lastId = q.data?.messages[q.data.messages.length - 1]?.id ?? null;
  const refreshBadges = badges.refresh;
  const focused = useRef(false);
  const lastIdRef = useRef<number | null>(null);
  const readUpTo = useRef(0);
  lastIdRef.current = lastId;

  // Record reads only while this screen is focused, for messages that are on screen. Parents only:
  // view-only members never record reads.
  const markRead = useCallback(async () => {
    const upTo = lastIdRef.current;
    if (!threadId || !isParent || !focused.current || upTo == null || upTo <= readUpTo.current) return;
    readUpTo.current = upTo;
    try {
      await api.post<ThreadReadResponse>(`/api/threads/${threadId}/read`, { up_to: upTo });
      void refreshBadges();
    } catch {
      readUpTo.current = 0; // try again on the next load
    }
  }, [threadId, isParent, refreshBadges]);

  // Poll while the screen is focused (the co-parent may be replying right now).
  const { reload } = q;
  useFocusEffect(useCallback(() => {
    if (!threadId) return undefined;
    focused.current = true;
    void markRead();
    const timer = setInterval(() => { void reload(); }, POLL_MS);
    return () => { focused.current = false; clearInterval(timer); };
  }, [threadId, reload, markRead]));

  // A load brought new messages while focused: mark them read.
  useEffect(() => {
    if (lastId != null) void markRead();
  }, [lastId, markRead]);

  const send = async () => {
    if (!threadId || sending) return;
    const body = text;
    setSending(true);
    try {
      if (!(await toneGate(body))) { inputRef.current?.focus(); return; }
      const r = await attempt(() => api.post<IdResponse>(`/api/threads/${threadId}/messages`, { body }));
      if (r) {
        setText('');
        forceScroll.current = true;
        await q.reload();
      }
    } finally {
      setSending(false);
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    nearBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
  };
  const onContentSizeChange = () => {
    if (forceScroll.current || nearBottom.current) {
      // jump straight to the newest message on open; animate later additions
      scrollRef.current?.scrollToEnd({ animated: !firstScroll.current });
      firstScroll.current = false;
      forceScroll.current = false;
    }
  };

  if (!threadId) return <ErrorView title="Conversation not found" message="This link doesn't point to a conversation." />;

  const data = q.data;
  const title = data?.thread.subject ?? 'Conversation';
  const header = <Stack.Screen options={{ title }} />;

  if (!data) {
    return (
      <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
        {header}
        {q.error ? (
          <ErrorView
            title={q.error.status === 404 ? 'Conversation not found' : 'Something went wrong'}
            message={q.error.status === 404 ? 'That conversation could not be found. It may belong to a different family.' : q.error.message}
            onRetry={q.error.status === 404 ? undefined : q.reload}
          />
        ) : <Loading />}
      </View>
    );
  }

  const today = todayLocal(tz);
  let prevDay = '';
  let prevAuthor: number | null = null;

  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]} testID="thread-screen">
      {header}
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // KeyboardAvoidingView measures itself relative to its parent, so add the nav bar above it.
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.root}
          contentContainerStyle={{ padding: t.spacing.lg, paddingBottom: t.spacing.md }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={64}
          onContentSizeChange={onContentSizeChange}
          refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} tintColor={t.colors.muted} colors={[t.colors.accent]} />}
          testID="thread-scroll"
        >
          <View style={styles.head}>
            <AppText variant="headline" align="center" testID="thread-subject">{data.thread.subject}</AppText>
            <View style={styles.headMeta}>
              <Badge label={topicLabel(data.thread.topic)} tone="accent" />
              <AppText variant="footnote" tone="muted">{`${data.messages.length} message${data.messages.length === 1 ? '' : 's'}`}</AppText>
            </View>
          </View>
          {data.messages.map((m) => {
            const day = isoDay(m.created_at, tz);
            const sep = day !== prevDay ? <DaySeparator label={day === today ? 'Today' : fmtDate(day)} /> : null;
            const showAuthor = !!sep || prevAuthor !== m.author;
            prevDay = day;
            prevAuthor = m.author;
            return (
              <View key={m.id}>
                {sep}
                <MessageBubble message={m} mine={m.author === myId} tz={tz} showAuthor={showAuthor} />
              </View>
            );
          })}
        </ScrollView>
        {isParent ? (
          <Composer ref={inputRef} value={text} onChange={setText} onSend={send} sending={sending} />
        ) : (
          <View style={[styles.viewer, { backgroundColor: t.colors.panel, borderTopColor: t.colors.line, paddingBottom: Math.max(insets.bottom, 10) }]}>
            <Callout tone="neutral" style={{ marginBottom: 0 }}>View only: you can read this conversation but not reply. Messages are permanent and read times are recorded.</Callout>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { alignItems: 'center', marginBottom: 8, gap: 6 },
  headMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 10 },
});
