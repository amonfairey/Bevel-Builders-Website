import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { AppText } from './AppText';

export interface ScreenProps {
  /**
   * Large in-content title (iOS large-title style) for screens WITHOUT a navigation bar:
   * tab roots, sign-in, setup. Implies `safeTop`.
   */
  title?: string;
  /** Muted line under the large title. */
  subtitle?: string;
  /** Element shown to the right of the large title (e.g. a "New" button). */
  titleRight?: ReactNode;
  /** Sets the navigation bar title of a pushed stack screen. */
  headerTitle?: string;
  /** Navigation bar right button for a pushed stack screen. */
  headerRight?: () => ReactNode;
  /** Pad the top safe area (no nav bar above). Defaults to true when `title` is set. */
  safeTop?: boolean;
  /** Wrap content in a ScrollView (default true). Set false for screens that use a FlatList. */
  scroll?: boolean;
  /** Pull-to-refresh: pass both. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Horizontal + vertical content padding (default true). */
  padded?: boolean;
  /** Pinned at the bottom, above the keyboard (e.g. a message composer or a Save button). */
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

/**
 * Standard screen container: themed background, safe areas, scrolling, pull-to-refresh,
 * keyboard avoidance (iOS adjusts insets automatically) and an optional large title.
 */
export function Screen({
  title, subtitle, titleRight, headerTitle, headerRight, safeTop, scroll = true, refreshing, onRefresh,
  padded = true, footer, contentStyle, children, testID,
}: ScreenProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const top = (safeTop ?? !!title) ? insets.top : 0;
  const pad = padded ? t.spacing.lg : 0;

  const header = (headerTitle !== undefined || headerRight) ? (
    <Stack.Screen options={{ ...(headerTitle !== undefined ? { title: headerTitle } : {}), ...(headerRight ? { headerRight } : {}) }} />
  ) : null;

  const titleBlock = title ? (
    <View style={styles.titleRow}>
      <View style={{ flex: 1 }}>
        <AppText variant="largeTitle" accessibilityRole="header">{title}</AppText>
        {subtitle ? <AppText variant="subhead" tone="muted" style={{ marginTop: 2 }}>{subtitle}</AppText> : null}
      </View>
      {titleRight ? <View style={{ marginLeft: t.spacing.md }}>{titleRight}</View> : null}
    </View>
  ) : null;

  const inner = (
    <>
      {titleBlock}
      {children}
    </>
  );

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ paddingHorizontal: pad, paddingTop: top + (padded ? t.spacing.md : 0), paddingBottom: (footer ? t.spacing.lg : insets.bottom + t.spacing.xl) }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="never"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.colors.muted} colors={[t.colors.accent]} /> : undefined}
      testID={testID}
    >
      {inner}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: pad, paddingTop: top + (padded ? t.spacing.md : 0) }, contentStyle]} testID={testID}>{inner}</View>
  );

  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
      {header}
      {footer ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
          <View style={{ paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.sm, paddingBottom: Math.max(insets.bottom, t.spacing.sm), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.line, backgroundColor: t.colors.panel }}>
            {footer}
          </View>
        </KeyboardAvoidingView>
      ) : body}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 16 },
});
