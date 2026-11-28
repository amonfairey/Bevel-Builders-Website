import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import type { Message } from '@/lib/types';
import { fmtWhen } from './format';

/**
 * One message, iMessage style: mine on the right in the accent color, theirs on the left.
 * Under each bubble: author and time, plus (for my messages) when the co-parent read it.
 */
export function MessageBubble({ message, mine, tz, showAuthor }: { message: Message; mine: boolean; tz: string; showAuthor: boolean }) {
  const t = useTheme();
  const read = message.reads[0];
  const meta = [mine ? 'You' : message.author_name, fmtWhen(message.created_at, tz)].join(' · ');
  return (
    <View style={[styles.wrap, mine ? styles.mineWrap : styles.theirsWrap]} testID={`message-${message.id}`}>
      {showAuthor && !mine ? <AppText variant="caption" tone="muted" style={styles.author}>{message.author_name}</AppText> : null}
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: t.colors.accent, borderBottomRightRadius: 4 }
            : { backgroundColor: t.colors.panel, borderColor: t.colors.line, borderWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 4 },
        ]}
      >
        <AppText selectable style={mine ? { color: t.colors.accentInk } : undefined}>{message.body}</AppText>
      </View>
      <AppText variant="caption" tone="muted" style={[styles.meta, mine && { textAlign: 'right' }]}>{meta}</AppText>
      {mine ? (
        <AppText variant="caption" weight="500" tone={read ? 'muted' : 'warn'} style={[styles.meta, { textAlign: 'right' }]} testID={`message-${message.id}-read`}>
          {read ? `Read ${fmtWhen(read.at, tz)}` : 'Not yet read'}
        </AppText>
      ) : null}
    </View>
  );
}

/** Centered day label between messages from different days. */
export function DaySeparator({ label }: { label: string }) {
  return <AppText variant="caption" tone="muted" weight="600" align="center" style={styles.day}>{label}</AppText>;
}

const styles = StyleSheet.create({
  wrap: { maxWidth: '82%', marginBottom: 10 },
  mineWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirsWrap: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  author: { marginLeft: 12, marginBottom: 2 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  meta: { marginTop: 3, marginHorizontal: 6 },
  day: { marginVertical: 10 },
});
