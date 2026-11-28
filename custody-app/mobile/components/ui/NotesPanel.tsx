import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '@/lib/api';
import { fmtIso } from '@/lib/format';
import { useApi, useMe } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import type { FilePayload, IdResponse, Note, NoteTargetType } from '@/lib/types';
import { AppText } from './AppText';
import { AttachmentLink, PhotoPicker } from './Attachment';
import { Button } from './Button';
import { Section } from './Card';
import { TextArea } from './Field';
import { ErrorView, Loading } from './States';
import { useAttempt } from './Toast';

/**
 * Append-only notes on any record (schedule rule, activity, expense, payment, call,
 * exchange, calendar day 'YYYY-MM-DD', or 'general' journal). Parents can add a note with
 * an optional photo; nobody can edit or delete one.
 */
export function NotesPanel({ targetType, targetId, title = 'Notes' }: { targetType: NoteTargetType; targetId: string | number; title?: string }) {
  const me = useMe();
  const t = useTheme();
  const attempt = useAttempt();
  const tz = me.family.timezone;
  const path = `/api/notes?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(String(targetId))}`;
  const q = useApi<Note[]>(path);
  const [text, setText] = useState('');
  const [file, setFile] = useState<FilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!text.trim()) { setError('Write a note first'); return; }
    const r = await attempt(() => api.post<IdResponse>('/api/notes', { target_type: targetType, target_id: String(targetId), body: text, attachment: file }), 'Note saved');
    if (r) { setText(''); setFile(null); await q.reload(); }
  };

  return (
    <Section title={title}>
      {q.data === undefined ? (q.error ? <ErrorView message={q.error.message} onRetry={q.reload} /> : <Loading />) : q.data.length === 0 ? (
        <AppText tone="muted" style={{ marginBottom: 8 }}>No notes yet.</AppText>
      ) : q.data.map((n) => (
        <View key={n.id} style={[styles.note, { borderLeftColor: t.colors.line }]}>
          <AppText>{n.body}</AppText>
          {n.attachment_hash ? <AttachmentLink hash={n.attachment_hash} name={n.attachment_name} type={n.attachment_type} /> : null}
          <AppText variant="footnote" tone="muted" style={{ marginTop: 2 }}>{`${n.author_name} · ${fmtIso(n.created_at, tz)}`}</AppText>
        </View>
      ))}
      {me.role === 'parent' ? (
        <View style={{ marginTop: 8 }}>
          <TextArea
            label="Add a note"
            value={text}
            onChangeText={(v) => { setText(v); if (error) setError(null); }}
            placeholder="Stick to facts: what happened, when, who was there."
            hint="Notes are permanent: they cannot be edited or deleted after saving."
            error={error}
          />
          <PhotoPicker value={file} onChange={setFile} />
          <Button title="Save note" variant="primary" onPress={save} style={{ marginTop: 12 }} />
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  note: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 4, marginBottom: 10 },
});
