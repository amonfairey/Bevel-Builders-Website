import { Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, tapHaptic, type IconName } from '@/components/ui';
import { fmtAgo, fmtIso } from '@/lib/format';
import { TOUCH, useTheme } from '@/lib/theme';
import type { AppNotification } from '@/lib/types';

/** Icon per link section (same sections as the web portal's NOTIF_ICON). */
const ICON: Record<string, IconName> = {
  dashboard: 'home', calendar: 'calendar', schedule: 'git-compare', activities: 'football', expenses: 'wallet',
  messages: 'chatbubbles', calls: 'call', exchanges: 'swap-horizontal', records: 'document-text', settings: 'people',
};

/** 'just now' / '5 min ago' / '3 h ago' within a day, else 'Mon, Mar 9, 6:00 PM'. */
export function notificationTime(iso: string, tz: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return now - t < 86400000 ? fmtAgo(iso, tz, now) : fmtIso(iso, tz);
}

export function NotificationRow({ n, read, tz, onPress }: { n: AppNotification; read: boolean; tz: string; onPress: (n: AppNotification) => void }) {
  const t = useTheme();
  const section = String(n.link || '').split('/')[0];
  const icon = ICON[section] ?? 'notifications';
  return (
    <Pressable
      onPress={() => { tapHaptic(); onPress(n); }}
      accessibilityRole="button"
      accessibilityLabel={`${read ? '' : 'Unread. '}${n.title}${n.body ? `. ${n.body}` : ''}. ${notificationTime(n.created_at, tz)}`}
      testID={`notif-${n.id}`}
      style={({ pressed }) => [styles.row, !read && { backgroundColor: t.colors.accentSoft }, pressed && { backgroundColor: t.colors.soft }]}
    >
      <View style={[styles.icon, { backgroundColor: read ? t.colors.soft : t.colors.accent }]}>
        <Ionicons name={icon} size={17} color={read ? t.colors.muted : t.colors.accentInk} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText weight={read ? '400' : '600'} numberOfLines={2}>{n.title}</AppText>
        {n.body ? <AppText variant="subhead" tone="muted" numberOfLines={3}>{n.body}</AppText> : null}
        <AppText variant="footnote" tone="muted" style={{ marginTop: 2 }}>{notificationTime(n.created_at, tz)}</AppText>
      </View>
      <View style={[styles.dot, { backgroundColor: read ? 'transparent' : t.colors.accent }]} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}

/** Rounded panel for notification rows, separators inset past the icon (iOS Mail style). */
export function NotificationList({ children }: { children: ReactNode[] }) {
  const t = useTheme();
  return (
    <View style={[styles.group, { backgroundColor: t.colors.panel, borderColor: t.colors.line }]}>
      {children.map((c, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.line, marginLeft: 60 }} /> : null}
          {c}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', minHeight: TOUCH + 12, paddingHorizontal: 16, paddingVertical: 12 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, marginLeft: 8, marginTop: 7 },
});
