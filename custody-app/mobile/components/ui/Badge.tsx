import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { statusLabel, statusTone } from '@/lib/status';
import { useTheme, type Tone } from '@/lib/theme';
import { AppText } from './AppText';

/** Small rounded label (web portal `.badge`). */
export function Badge({ label, tone = 'neutral', style }: { label: string; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: t.toneSoft(tone) }, style]} accessibilityRole="text">
      <AppText variant="caption" weight="600" style={{ color: tone === 'neutral' ? t.colors.muted : t.tone(tone) }} numberOfLines={1}>{label}</AppText>
    </View>
  );
}

/** Badge for a record status using the shared label/tone map (lib/status.ts). */
export function StatusBadge({ status, style }: { status: string; style?: StyleProp<ViewStyle> }) {
  return <Badge label={statusLabel(status)} tone={statusTone(status)} style={style} />;
}

/** Red count pill (menus, list rows). Renders nothing for 0. */
export function CountBadge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  if (!count) return null;
  return (
    <View style={[styles.count, { backgroundColor: t.colors.bad }, style]} accessibilityLabel={`${count} new`}>
      <AppText variant="caption" weight="700" style={{ color: '#fff' }}>{count > 99 ? '99+' : String(count)}</AppText>
    </View>
  );
}

/** Colored dot for a person (pass the member color, e.g. colorOf(me, id)). */
export function Dot({ color, size = 10, style }: { color: string; size?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
});
