import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Badge, Card, Row, StatusBadge } from '@/components/ui';
import { fmtIso } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useTheme, type Tone } from '@/lib/theme';
import type { Rule } from '@/lib/types';
import { ruleSummary } from './summary';

/** Decision line: 'Approved by Sam, Mon, Mar 9, 6:00 PM' (Confirmed / Disputed for unconfirmed items). */
export function decisionLine(r: Rule, tz: string): string | null {
  if (!r.decided_by) return null;
  const verb = r.status === 'rejected' ? 'Rejected' : 'Approved';
  return `${verb} by ${r.decided_by_name ?? 'the other parent'}, ${fmtIso(r.decided_at, tz)}`;
}

/** One schedule item in a list: name, status, plain-language summary, who asked and when. Tap opens the detail. */
export function RuleRow({ rule: r, tone, testID }: { rule: Rule; tone?: Tone; testID?: string }) {
  const t = useTheme();
  const { tz, nameOf, myId } = usePeople();
  const decided = decisionLine(r, tz);
  return (
    <Card
      tone={tone}
      onPress={() => router.push(routes.rule(r.id) as Href)}
      accessibilityLabel={`${r.name}, opens details`}
      testID={testID ?? `rule-${r.id}`}
    >
      <Row align="flex-start">
        <View style={{ flex: 1 }}>
          <AppText variant="headline" numberOfLines={2}>{r.name}</AppText>
          <Row wrap gap={6} style={{ marginTop: 4 }}>
            <StatusBadge status={r.status} />
            {r.retire_requested_by ? <Badge label="End requested" tone="warn" /> : null}
          </Row>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.colors.muted} style={{ marginTop: 2, marginLeft: 6 }} />
      </Row>
      <AppText variant="subhead" style={{ marginTop: 8 }} numberOfLines={4}>{ruleSummary(r, nameOf)}</AppText>
      {r.reason ? <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }} numberOfLines={2}>{`Reason: ${r.reason}`}</AppText> : null}
      <AppText variant="footnote" tone="muted" style={{ marginTop: 6 }}>
        {`Requested by ${r.requested_by === myId ? 'you' : r.requested_by_name}, ${fmtIso(r.requested_at, tz)}`}
      </AppText>
      {decided ? (
        <AppText variant="footnote" tone="muted" numberOfLines={2}>{`${decided}${r.decision_note ? ` — “${r.decision_note}”` : ''}`}</AppText>
      ) : null}
    </Card>
  );
}
