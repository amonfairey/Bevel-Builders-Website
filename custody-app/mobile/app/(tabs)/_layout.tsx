import type { ComponentProps } from 'react';
import { Platform, type ColorValue } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { useBadges } from '@/lib/badges';
import { useTheme } from '@/lib/theme';

export const unstable_settings = { anchor: 'index' };

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(base: string) {
  return ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons name={(focused ? base : `${base}-outline`) as IconName} size={size} color={typeof color === 'string' ? color : undefined} />
  );
}

/**
 * Five tabs. Badges: Home = decisions waiting on me (dashboard pending, excluding messages),
 * Messages = unread messages. Tab roots have no nav bar; screens draw large titles (Screen title).
 */
export default function TabsLayout() {
  const t = useTheme();
  const { decisions, unreadMessages } = useBadges();
  const badge = (n: number) => (n > 0 ? (n > 99 ? '99+' : n) : undefined);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.accent,
        tabBarInactiveTintColor: t.colors.muted,
        // The web preview has no home-indicator inset, so give labels room for descenders there.
        tabBarStyle: [{ backgroundColor: t.colors.panel, borderTopColor: t.colors.line }, Platform.OS === 'web' ? { height: 58, paddingBottom: 6 } : null],
        tabBarBadgeStyle: { backgroundColor: t.colors.bad, color: '#fff', fontSize: 11 },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
        sceneStyle: { backgroundColor: t.colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home'), tabBarBadge: badge(decisions), tabBarButtonTestID: 'tab-home' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: icon('calendar'), tabBarButtonTestID: 'tab-calendar' }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages', tabBarIcon: icon('chatbubbles'), tabBarBadge: badge(unreadMessages), tabBarButtonTestID: 'tab-messages' }} />
      <Tabs.Screen name="money" options={{ title: 'Money', tabBarIcon: icon('wallet'), tabBarButtonTestID: 'tab-money' }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal-circle'), tabBarButtonTestID: 'tab-more' }} />
    </Tabs>
  );
}
