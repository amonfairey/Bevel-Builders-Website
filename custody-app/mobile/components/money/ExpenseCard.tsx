import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Card, StatusBadge } from '@/components/ui';
import { fmtShortDate, money } from '@/lib/format';
import { childNames, nameOf, parents } from '@/lib/hooks';
import { useTheme, type Tone } from '@/lib/theme';
import type { Expense, Me } from '@/lib/types';
import { categoryLabel } from './constants';

/**
 * Who owes the share of an expense, from the viewer's point of view:
 * the payer sees "<co-parent>'s share", the other parent sees "Your share",
 * a view-only member sees "<name>'s share".
 */
export function shareOwnerLabel(me: Me, e: Expense): string {
  const owerId = parents(me).find((p) => p.id !== e.paid_by)?.id;
  if (owerId === me.user.id) return 'Your share';
  return owerId != null ? `${nameOf(me, owerId)}'s share` : "Other parent's share";
}

/** One expense in a list: description, amount, status, date, category, children, payer, share. Taps open the detail. */
export function ExpenseCard({ me, e, onPress, tone, children }: { me: Me; e: Expense; onPress?: () => void; tone?: Tone; children?: ReactNode }) {
  const t = useTheme();
  const meta = [
    fmtShortDate(e.date),
    categoryLabel(e.category),
    childNames(me, e.child_ids) || null,
    `paid by ${e.paid_by === me.user.id ? 'you' : nameOf(me, e.paid_by)}`,
  ].filter(Boolean).join(' · ');
  return (
    <Card onPress={onPress} tone={tone} accessibilityLabel={`${e.description}, ${money(e.amount_cents)}`} testID={`expense-${e.id}`}>
      <View style={styles.head}>
        <AppText weight="600" style={{ flex: 1 }} numberOfLines={2}>{e.description}</AppText>
        <AppText weight="700" style={{ marginLeft: 8 }}>{money(e.amount_cents)}</AppText>
      </View>
      <View style={styles.badges}>
        <StatusBadge status={e.status} />
        {e.receipt_hash ? (
          <View style={styles.inline}>
            <Ionicons name={e.receipt_type === 'application/pdf' ? 'document-attach-outline' : 'image-outline'} size={14} color={t.colors.muted} />
            <AppText variant="caption" tone="muted" style={{ marginLeft: 3 }}>Receipt</AppText>
          </View>
        ) : null}
        {e.note_count ? (
          <View style={styles.inline}>
            <Ionicons name="chatbox-ellipses-outline" size={14} color={t.colors.muted} />
            <AppText variant="caption" tone="muted" style={{ marginLeft: 3 }}>{String(e.note_count)}</AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="footnote" tone="muted" style={{ marginTop: 6 }}>{meta}</AppText>
      <AppText variant="footnote" tone="muted">{`${shareOwnerLabel(me, e)} ${e.other_share_pct}% = ${money(e.owed_cents)}`}</AppText>
      {e.decision_note ? <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }} numberOfLines={3}>{`Response: "${e.decision_note}"`}</AppText> : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  inline: { flexDirection: 'row', alignItems: 'center' },
});
