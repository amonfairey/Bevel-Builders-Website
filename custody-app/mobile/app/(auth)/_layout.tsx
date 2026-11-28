import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

export const unstable_settings = { anchor: 'sign-in' };

/** Signed-out screens: no navigation bar, the screens draw their own large titles. */
export default function AuthLayout() {
  const t = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }}>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
    </Stack>
  );
}
