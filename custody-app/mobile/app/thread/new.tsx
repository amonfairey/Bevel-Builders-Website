import { useRef, useState } from 'react';
import { router, type Href } from 'expo-router';
import { AppText, Button, Chips, EmptyState, Field, FieldShell, HeaderButton, Screen, TextArea, useAttempt, useToneGate, type TextInputRef } from '@/components/ui';
import { TOPICS } from '@/components/messages/format';
import { api } from '@/lib/api';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { IdResponse, ThreadTopic } from '@/lib/types';

/** New conversation (iOS sheet): subject, topic and first message, tone-checked before sending. */
export default function NewThreadScreen() {
  const { isParent } = usePeople();
  const toneGate = useToneGate();
  const attempt = useAttempt();
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState<ThreadTopic>('general');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<TextInputRef>(null);

  const send = async () => {
    if (busy) return;
    const e: typeof errors = {};
    if (!subject.trim()) e.subject = 'Add a subject';
    if (!body.trim()) e.body = 'Write a message';
    setErrors(e);
    if (e.subject || e.body) return;
    setBusy(true);
    try {
      if (!(await toneGate(body))) { bodyRef.current?.focus(); return; }
      const r = await attempt(() => api.post<IdResponse>('/api/threads', { subject: subject.trim(), topic, body }));
      if (r) router.replace(routes.thread(r.id) as Href);
    } finally {
      setBusy(false);
    }
  };

  if (!isParent) {
    return (
      <Screen headerTitle="New conversation">
        <EmptyState icon="eye-outline" title="View only" message="Only parents can start conversations." />
      </Screen>
    );
  }

  return (
    <Screen headerTitle="New conversation" headerRight={() => <HeaderButton title="Send" bold onPress={send} disabled={busy} testID="header-send" />} testID="new-thread-screen">
      <Field
        label="Subject"
        value={subject}
        onChangeText={(v) => { setSubject(v); if (errors.subject) setErrors({ ...errors, subject: undefined }); }}
        placeholder="e.g. Spring break dates"
        maxLength={150}
        returnKeyType="next"
        onSubmitEditing={() => bodyRef.current?.focus()}
        error={errors.subject}
        testID="thread-subject-input"
      />
      <FieldShell label="Topic">
        <Chips options={TOPICS} values={[topic]} onChange={(v) => { if (v[0]) setTopic(v[0]); }} multiple={false} />
      </FieldShell>
      <TextArea
        ref={bodyRef}
        label="Message"
        value={body}
        onChangeText={(v) => { setBody(v); if (errors.body) setErrors({ ...errors, body: undefined }); }}
        placeholder="Brief, informative, friendly, firm."
        maxLength={8000}
        error={errors.body}
        testID="thread-body-input"
      />
      <AppText variant="footnote" tone="muted" style={{ marginBottom: 16 }}>
        Messages are permanent: they can't be edited or deleted, and read times are recorded. Your message gets a tone check before it's sent.
      </AppText>
      <Button title="Send" icon="send" variant="primary" block onPress={send} loading={busy} testID="thread-send" />
    </Screen>
  );
}
