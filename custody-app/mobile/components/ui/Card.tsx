import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, type Tone } from '@/lib/theme';
import { AppText } from './AppText';

export interface CardProps {
  children?: ReactNode;
  /** Colored left border for attention (like the web portal's warn cards). */
  tone?: Tone;
  onPress?: () => void;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/** Rounded panel (web portal `.card`). Tappable when `onPress` is set. */
export function Card({ children, tone, onPress, padded = true, style, accessibilityLabel, testID }: CardProps) {
  const t = useTheme();
  const base: StyleProp<ViewStyle> = [
    styles.card,
    { backgroundColor: t.colors.panel, borderColor: t.colors.line, padding: padded ? t.spacing.lg : 0 },
    tone && tone !== 'neutral' ? { borderLeftWidth: 4, borderLeftColor: t.tone(tone) } : null,
    style,
  ];
  if (!onPress) return <View style={base} testID={testID}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID={testID}>
      {children}
    </Pressable>
  );
}

export interface SectionProps {
  title?: string;
  /** Right-aligned element on the header line (e.g. a link Button). */
  action?: ReactNode;
  /** Muted text under the content. */
  footer?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Grouped section: small uppercase header (iOS settings style), content, optional footnote. */
export function Section({ title, action, footer, children, style }: SectionProps) {
  const t = useTheme();
  return (
    <View style={[{ marginBottom: t.spacing.xl }, style]}>
      {title || action ? (
        <View style={styles.sectionHead}>
          {title ? <AppText variant="footnote" tone="muted" style={styles.sectionTitle} accessibilityRole="header">{title.toUpperCase()}</AppText> : <View />}
          {action}
        </View>
      ) : null}
      {children}
      {footer ? <AppText variant="footnote" tone="muted" style={{ marginTop: t.spacing.sm, marginHorizontal: t.spacing.xs }}>{footer}</AppText> : null}
    </View>
  );
}

/** Colored notice box (web portal `.alert`). */
export function Callout({ tone = 'accent', title, children, style }: { tone?: Tone; title?: string; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.callout, { backgroundColor: t.toneSoft(tone === 'neutral' ? 'neutral' : tone), borderLeftColor: t.tone(tone) }, style]} accessibilityRole="summary">
      {title ? <AppText variant="subhead" weight="600" style={{ marginBottom: 2 }}>{title}</AppText> : null}
      {typeof children === 'string' ? <AppText variant="subhead">{children}</AppText> : children}
    </View>
  );
}

/** Thin separator line. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.line, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, marginBottom: 12 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingHorizontal: 4, minHeight: 28 },
  sectionTitle: { letterSpacing: 0.4 },
  callout: { borderLeftWidth: 4, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
});
