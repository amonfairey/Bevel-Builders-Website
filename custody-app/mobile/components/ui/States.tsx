import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/lib/theme';
import { AppText } from './AppText';
import { Button, type IconName } from './Button';

/** Centered icon + title + message, with an optional action (empty lists, "coming soon"). */
export function EmptyState({ icon = 'file-tray-outline', title, message, actionLabel, onAction, children }: {
  icon?: IconName; title: string; message?: string; actionLabel?: string; onAction?: () => unknown; children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={styles.center} accessibilityRole="summary">
      <View style={[styles.iconWrap, { backgroundColor: t.colors.accentSoft }]}>
        <Ionicons name={icon} size={30} color={t.colors.accent} />
      </View>
      <AppText variant="title3" align="center" style={{ marginTop: 14 }}>{title}</AppText>
      {message ? <AppText tone="muted" align="center" style={{ marginTop: 6, maxWidth: 320 }}>{message}</AppText> : null}
      {actionLabel && onAction ? <Button title={actionLabel} variant="primary" onPress={onAction} style={{ marginTop: 18, alignSelf: 'center' }} /> : null}
      {children}
    </View>
  );
}

/** Error message with a Retry button. */
export function ErrorView({ message, onRetry, title = 'Something went wrong' }: { message: string; onRetry?: () => unknown; title?: string }) {
  const t = useTheme();
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={36} color={t.colors.bad} />
      <AppText variant="headline" align="center" style={{ marginTop: 10 }}>{title}</AppText>
      <AppText tone="muted" align="center" style={{ marginTop: 6, maxWidth: 320 }}>{message}</AppText>
      {onRetry ? <Button title="Try again" icon="refresh" onPress={onRetry} style={{ marginTop: 16, alignSelf: 'center' }} /> : null}
    </View>
  );
}

/** Spinner, optionally full-screen (fills and centers on the themed background). */
export function Loading({ label, full }: { label?: string; full?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.center, full && { flex: 1, backgroundColor: t.colors.bg }]} accessibilityLabel={label ?? 'Loading'} accessibilityRole="progressbar">
      <ActivityIndicator color={t.colors.muted} />
      {label ? <AppText tone="muted" style={{ marginTop: 8 }}>{label}</AppText> : null}
    </View>
  );
}

/**
 * Renders loading / error / content for a useApi() result:
 *   <AsyncView state={q}>{(data) => <List data={data} />}</AsyncView>
 */
export function AsyncView<T>({ state, children }: { state: { data: T | undefined; error: { message: string } | null; loading: boolean; reload: () => unknown }; children: (data: T) => ReactNode }) {
  if (state.data !== undefined) return <>{children(state.data)}</>;
  if (state.error) return <ErrorView message={state.error.message} onRetry={state.reload} />;
  return <Loading />;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
