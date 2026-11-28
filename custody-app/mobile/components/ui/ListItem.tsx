import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TOUCH, useTheme } from '@/lib/theme';
import { AppText } from './AppText';
import { CountBadge } from './Badge';
import { tapHaptic, type IconName } from './Button';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  /** Ionicons name in a tinted rounded square (iOS settings style) */
  icon?: IconName;
  /** icon tint; defaults to the accent */
  iconColor?: string;
  /** custom element on the left instead of an icon (e.g. a ParentDot) */
  left?: ReactNode;
  /** text or element on the right, before the chevron */
  right?: ReactNode;
  /** red count pill on the right */
  badge?: number;
  onPress?: () => void;
  /** show a chevron (default: when onPress is set) */
  chevron?: boolean;
  destructive?: boolean;
  testID?: string;
}

/** One row of a grouped list (menus, settings, simple record lists). */
export function ListItem({ title, subtitle, icon, iconColor, left, right, badge, onPress, chevron, destructive, testID }: ListItemProps) {
  const t = useTheme();
  const showChevron = chevron ?? !!onPress;
  const content = (
    <View style={styles.row}>
      {icon ? (
        <View style={[styles.icon, { backgroundColor: iconColor ?? (destructive ? t.colors.bad : t.colors.accent) }]}>
          <Ionicons name={icon} size={17} color="#fff" />
        </View>
      ) : left ? <View style={{ marginRight: 12 }}>{left}</View> : null}
      <View style={{ flex: 1 }}>
        <AppText style={destructive ? { color: t.colors.bad } : undefined} numberOfLines={2}>{title}</AppText>
        {subtitle ? <AppText variant="footnote" tone="muted" numberOfLines={3}>{subtitle}</AppText> : null}
      </View>
      {typeof right === 'string' ? <AppText tone="muted" style={{ marginLeft: 8 }}>{right}</AppText> : right}
      {badge ? <CountBadge count={badge} style={{ marginLeft: 8 }} /> : null}
      {showChevron ? <Ionicons name="chevron-forward" size={18} color={t.colors.muted} style={{ marginLeft: 6 }} /> : null}
    </View>
  );
  if (!onPress) return <View style={styles.pad} testID={testID}>{content}</View>;
  return (
    <Pressable
      onPress={() => { tapHaptic(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`${title}${badge ? `, ${badge} new` : ''}`}
      testID={testID}
      style={({ pressed }) => [styles.pad, pressed && { backgroundColor: t.colors.soft }]}
    >
      {content}
    </Pressable>
  );
}

/** Inset grouped container for ListItems with hairline separators between rows. */
export function ListGroup({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const items = Children.toArray(children).filter((c) => isValidElement(c));
  return (
    <View style={[styles.group, { backgroundColor: t.colors.panel, borderColor: t.colors.line }, style]}>
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.line, marginLeft: 16 }} /> : null}
          {c}
        </Fragment>
      ))}
    </View>
  );
}

/** Horizontal flex row with a gap (layout helper). */
export function Row({ children, gap = 8, wrap, align = 'center', justify, style }: {
  children?: ReactNode; gap?: number; wrap?: boolean; align?: ViewStyle['alignItems']; justify?: ViewStyle['justifyContent']; style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  pad: { minHeight: TOUCH + 4, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 30, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  group: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginBottom: 12 },
});
