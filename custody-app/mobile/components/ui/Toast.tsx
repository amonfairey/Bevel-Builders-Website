import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { AppText } from './AppText';

export interface ToastApi {
  /** Brief message at the bottom of the screen (2.6 s). tone 'bad' adds an error haptic. */
  show: (message: string, opts?: { tone?: 'ok' | 'bad' }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ToastApi['show']>((message, opts) => {
    if (timer.current) clearTimeout(timer.current);
    setMsg(message);
    if (Platform.OS !== 'web' && opts?.tone) {
      Haptics.notificationAsync(opts.tone === 'bad' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start(() => setMsg(null));
    }, 2600);
  }, [opacity]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {msg ? (
        <Animated.View pointerEvents="none" style={[styles.toast, { opacity, bottom: insets.bottom + 64, backgroundColor: t.colors.ink }]} accessibilityLiveRegion="polite" accessibilityRole="alert" testID="toast">
          <AppText variant="subhead" style={{ color: t.colors.bg }} align="center">{msg}</AppText>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}

/**
 * Run an async action, toast its error (and optionally a success message), like the web
 * portal's attempt(). Returns the result, or undefined if it failed.
 *
 *   const attempt = useAttempt();
 *   await attempt(() => api.post('/api/expenses', body), 'Expense saved');
 */
export function useAttempt() {
  const toast = useToast();
  return useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (okMsg) toast.show(okMsg, { tone: 'ok' });
      return r;
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'bad' });
      return undefined;
    }
  }, [toast]);
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', alignSelf: 'center', maxWidth: '90%', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
});
