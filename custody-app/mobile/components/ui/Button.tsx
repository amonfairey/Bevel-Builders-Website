import { useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TOUCH, useTheme } from '@/lib/theme';
import { AppText } from './AppText';

export type ButtonVariant = 'primary' | 'default' | 'danger' | 'ok' | 'link';
export type IconName = ComponentProps<typeof Ionicons>['name'];

export interface ButtonProps {
  title: string;
  /** May return a Promise: the button shows a spinner and ignores taps until it settles. */
  onPress?: () => unknown;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** Ionicons name shown before the title. */
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the full width. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/** Light haptic tap on iOS/Android; no-op on web. */
export function tapHaptic(): void {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/**
 * Button with the web portal's variants: primary (filled accent), default (outlined),
 * danger / ok (outlined, colored text) and link (text only). 44 pt touch target.
 */
export function Button({ title, onPress, variant = 'default', size = 'md', icon, loading, disabled, block, style, accessibilityLabel, testID }: ButtonProps) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const spinning = !!loading || busy;
  const inactive = !!disabled || spinning;

  const fg = variant === 'primary' ? t.colors.accentInk
    : variant === 'danger' ? t.colors.bad
      : variant === 'ok' ? t.colors.ok
        : variant === 'link' ? t.colors.accent
          : t.colors.ink;
  const bg = variant === 'primary' ? t.colors.accent : variant === 'link' ? 'transparent' : t.colors.panel;
  const border = variant === 'primary' ? t.colors.accent : variant === 'link' ? 'transparent' : t.colors.line;

  const handle = async () => {
    if (inactive || !onPress) return;
    tapHaptic();
    const r = onPress();
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      setBusy(true);
      try { await r; } catch { /* callers show their own errors */ } finally { setBusy(false); }
    }
  };

  const small = size === 'sm';
  return (
    <Pressable
      onPress={handle}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: spinning }}
      hitSlop={small || variant === 'link' ? 8 : 0}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variant === 'link' ? styles.link : { minHeight: small ? 36 : TOUCH, paddingHorizontal: small ? 12 : 16 },
        { backgroundColor: bg, borderColor: border, alignSelf: block ? 'stretch' : 'flex-start', opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <View style={styles.row}>
        {spinning ? <ActivityIndicator size="small" color={fg} style={{ marginRight: 8 }} />
          : icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} style={{ marginRight: 6 }} /> : null}
        <AppText variant={small ? 'subhead' : 'body'} weight={variant === 'primary' ? '600' : '500'} style={{ color: fg }} numberOfLines={1}>
          {title}
        </AppText>
      </View>
    </Pressable>
  );
}

/** Round icon-only button (nav bar actions, close buttons). */
export function IconButton({ icon, onPress, accessibilityLabel, color, size = 22, testID }: { icon: IconName; onPress: () => void; accessibilityLabel: string; color?: string; size?: number; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tapHaptic(); onPress(); }} accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={8} testID={testID}
      style={({ pressed }) => [{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 }]}>
      <Ionicons name={icon} size={size} color={color ?? t.colors.accent} />
    </Pressable>
  );
}

/**
 * Text button for the navigation bar (headerLeft / headerRight): "Cancel", "Save", "New".
 * `bold` for the confirming action, as on iOS.
 */
export function HeaderButton({ title, onPress, bold, disabled, testID }: { title: string; onPress: () => unknown; bold?: boolean; disabled?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => { if (!disabled) { tapHaptic(); onPress(); } }}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={10}
      testID={testID}
      style={({ pressed }) => [styles.headerBtn, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <AppText weight={bold ? '600' : '400'} style={{ color: t.colors.accent }}>{title}</AppText>
    </Pressable>
  );
}

/** Horizontal group of buttons that wraps (web portal `.actions`). */
export function ButtonRow({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.actions, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, justifyContent: 'center' },
  link: { minHeight: 32, paddingHorizontal: 0, borderWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  headerBtn: { minHeight: TOUCH, justifyContent: 'center', alignSelf: 'center', paddingHorizontal: Platform.OS === 'web' ? 16 : 4 },
});
