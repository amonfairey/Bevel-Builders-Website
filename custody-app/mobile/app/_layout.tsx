import { useEffect } from 'react';
import { Platform, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { router, Stack, ThemeProvider, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppText, Button, DialogProvider, ErrorView, HeaderButton, Loading, ToastProvider } from '@/components/ui';
import { BadgesProvider, useBadges } from '@/lib/badges';
import { API_URL } from '@/lib/config';
import { configureNotificationHandler, registerForPush, usePushRouting } from '@/lib/push';
import { AuthProvider, useSession } from '@/lib/session';
import { navigationTheme, useTheme } from '@/lib/theme';

// Show banners for pushes that arrive while the app is open (native only).
configureNotificationHandler();

export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navigationTheme(scheme === 'dark')}>
        <AuthProvider>
          <ToastProvider>
            <DialogProvider>
              <BadgesProvider>
                <RootNavigator />
              </BadgesProvider>
            </DialogProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

/** Cancel button for screens presented as iOS sheets (forms). */
function HeaderCancel() {
  return <HeaderButton title="Cancel" onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as Href))} testID="header-cancel" />;
}

const modal = { presentation: 'modal' as const, headerLeft: () => <HeaderCancel /> };

function RootNavigator() {
  const { status, bootError, refreshMe, signOut, me } = useSession();
  const t = useTheme();
  const badges = useBadges();
  const ready = status === 'ready';
  const userId = me?.user.id ?? null;

  // Register for push once per signed-in user (no-op on web, simulators, or without an EAS projectId).
  useEffect(() => {
    if (ready && userId != null) void registerForPush();
  }, [ready, userId]);

  // Notification taps (including the one that launched the app) open the linked screen.
  usePushRouting(ready, () => { void badges.refresh(); });

  if (status === 'loading') {
    if (!bootError) return <Loading full />;
    return (
      <View style={[styles.boot, { backgroundColor: t.colors.bg }]}>
        <ErrorView title="Can't connect" message={bootError} onRetry={() => refreshMe().catch(() => undefined)} />
        <AppText variant="footnote" tone="muted" align="center">{`Server: ${API_URL}`}</AppText>
        <Button title="Sign out" variant="link" onPress={signOut} style={{ alignSelf: 'center', marginTop: 12 }} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerTintColor: t.colors.accent,
        headerTitleStyle: { color: t.colors.ink },
        headerStyle: { backgroundColor: t.colors.panel },
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: t.colors.bg },
        headerShadowVisible: Platform.OS !== 'ios',
      }}
    >
      <Stack.Protected guard={status === 'signedOut'} redirectTo={(status === 'needsFamily' ? '/setup' : '/') as Href}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={status === 'needsFamily'} redirectTo={(status === 'signedOut' ? '/sign-in' : '/') as Href}>
        <Stack.Screen name="setup" options={{ headerShown: false, title: 'Set up' }} />
      </Stack.Protected>

      <Stack.Protected guard={ready} redirectTo={(status === 'signedOut' ? '/sign-in' : '/setup') as Href}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="day/[date]" options={{ title: 'Day' }} />

        <Stack.Screen name="schedule/index" options={{ title: 'Custody schedule' }} />
        <Stack.Screen name="schedule/[id]" options={{ title: 'Schedule item' }} />
        <Stack.Screen name="schedule/change" options={{ title: 'Request a change', ...modal }} />
        <Stack.Screen name="schedule/pattern" options={{ title: 'Regular schedule', ...modal }} />
        <Stack.Screen name="schedule/holiday" options={{ title: 'Holiday or period', ...modal }} />
        <Stack.Screen name="schedule/primary" options={{ title: 'Primary parent', ...modal }} />

        <Stack.Screen name="thread/[id]" options={{ title: 'Conversation' }} />
        <Stack.Screen name="thread/new" options={{ title: 'New conversation', ...modal }} />
        <Stack.Screen name="calls/index" options={{ title: 'Calls & video' }} />
        <Stack.Screen name="calls/log" options={{ title: 'Log a call', ...modal }} />
        <Stack.Screen name="calls/rule" options={{ title: 'Call schedule', ...modal }} />

        <Stack.Screen name="expense/new" options={{ title: 'Add expense', ...modal }} />
        <Stack.Screen name="expense/[id]" options={{ title: 'Expense' }} />
        <Stack.Screen name="payment/new" options={{ title: 'Record a payment', ...modal }} />
        <Stack.Screen name="activities/index" options={{ title: 'Activities' }} />
        <Stack.Screen name="activities/[id]" options={{ title: 'Activity' }} />
        <Stack.Screen name="activities/edit" options={{ title: 'Activity', ...modal }} />

        <Stack.Screen name="exchanges/index" options={{ title: 'Exchanges' }} />
        <Stack.Screen name="exchanges/check-in" options={{ title: 'Exchange check-in', ...modal }} />
        <Stack.Screen name="records" options={{ title: 'Records & reports' }} />
        <Stack.Screen name="sync" options={{ title: 'Calendar sync' }} />
        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings/child/[id]" options={{ title: 'Child' }} />
        <Stack.Screen name="settings/account" options={{ title: 'Account' }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, justifyContent: 'center', padding: 24 },
});
