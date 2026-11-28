import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui';
import { API_URL } from '@/lib/config';
import { useTheme } from '@/lib/theme';

/** App mark + name shown above the sign-in / sign-up forms. */
export function BrandMark() {
  const t = useTheme();
  return (
    <View style={styles.brand} accessibilityRole="header">
      <View style={[styles.mark, { backgroundColor: t.colors.accent }]}>
        <Ionicons name="people" size={22} color={t.colors.accentInk} />
      </View>
      <AppText variant="headline" style={{ marginLeft: 10 }}>CoParent Hub</AppText>
    </View>
  );
}

/** Which server the app talks to (helps when a phone points at the wrong address). */
export function ServerFootnote() {
  return (
    <AppText variant="caption" tone="muted" align="center" style={{ marginTop: 28 }} selectable>
      {`Server: ${API_URL.replace(/^https?:\/\//, '')}`}
    </AppText>
  );
}

/** Client-side checks that mirror the server's rules in POST /api/register. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MIN_PASSWORD = 10;

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  mark: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
});
