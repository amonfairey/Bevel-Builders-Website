import { useRef, useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Divider, ErrorView, Loading, Row, Section } from '@/components/ui';
import { fmtIso } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import type { AuditEntry } from '@/lib/types';

const PAGE = 50;
const MAX = 1000; // server cap for /api/audit?limit

const words = (s: string | null | undefined) => String(s ?? '').replace(/_/g, ' ');

/**
 * The hash-chained activity log, newest first, loaded 50 entries at a time.
 * Bump `refreshKey` to reload it (after adding something, or on pull-to-refresh).
 */
export function AuditLog({ tz, refreshKey = 0 }: { tz: string; refreshKey?: number }) {
  const t = useTheme();
  const [limit, setLimit] = useState(PAGE);
  const q = useApi<AuditEntry[]>(`/api/audit?limit=${limit}`, [refreshKey]);
  // keep showing the previous page while the next one loads
  const last = useRef<AuditEntry[] | undefined>(undefined);
  if (q.data) last.current = q.data;
  const rows = q.data ?? last.current;
  const more = rows !== undefined && rows.length >= limit && limit < MAX;

  return (
    <Section title="Activity log" footer="Every change anyone makes is recorded here with the server's time. Entries are chained by hash, so later edits are detectable.">
      {rows === undefined ? (q.error ? <ErrorView message={q.error.message} onRetry={q.reload} /> : <Loading />) : rows.length === 0 ? (
        <AppText tone="muted">Nothing recorded yet.</AppText>
      ) : (
        <View style={{ backgroundColor: t.colors.panel, borderColor: t.colors.line, borderWidth: 0.5, borderRadius: 12, overflow: 'hidden' }} testID="audit-log">
          {rows.map((a, i) => (
            <View key={a.id}>
              {i > 0 ? <Divider inset={16} /> : null}
              <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                <Row justify="space-between" align="flex-start">
                  <AppText style={{ flex: 1 }} numberOfLines={2}>{`${words(a.action)} ${words(a.entity)}${a.entity_id ? ` ${a.entity_id}` : ''}`}</AppText>
                  <AppText variant="footnote" tone="muted" style={{ marginLeft: 8 }}>{`#${a.seq}`}</AppText>
                </Row>
                <AppText variant="footnote" tone="muted">{`${a.user_name || 'System'} · ${fmtIso(a.ts, tz)}`}</AppText>
              </View>
            </View>
          ))}
        </View>
      )}
      {more ? (
        <Button title="Show older entries" size="sm" loading={q.loading && q.data === undefined} onPress={() => setLimit((l) => Math.min(MAX, l + PAGE))} style={{ marginTop: 10, alignSelf: 'center' }} testID="audit-more" />
      ) : null}
    </Section>
  );
}
