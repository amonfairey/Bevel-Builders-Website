import { useState } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { AppText, Button, Callout, Card, DateField, EmptyState, Field, Screen, Section, TextArea, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { childById, useMe } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import type { Child, ChildInfo, IdResponse, OkResponse } from '@/lib/types';

/** Same info fields (and keys) as the web portal's child form. */
const INFO_FIELDS: { key: string; placeholder?: string; multiline?: boolean }[] = [
  { key: 'School', placeholder: 'School name, grade' },
  { key: 'Teacher' },
  { key: 'Doctor', placeholder: 'Name, phone' },
  { key: 'Dentist', placeholder: 'Name, phone' },
  { key: 'Allergies', multiline: true },
  { key: 'Medications', multiline: true },
  { key: 'Insurance', placeholder: 'Provider, member number' },
  { key: 'Clothing / shoe size' },
  { key: 'Emergency contact', placeholder: 'Name, relationship, phone' },
  { key: 'Other', multiline: true },
];
const KNOWN = new Set(INFO_FIELDS.map((f) => f.key));

/**
 * One child's name, birthdate and shared info (web portal settings child form).
 * `/settings/child/new` adds a child. View-only members see it read-only.
 */
export default function ChildScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const me = useMe();
  const isNew = id === 'new';
  const child = !isNew && id ? childById(me, Number(id)) : undefined;

  if (!isNew && !child) {
    return (
      <Screen headerTitle="Child">
        <EmptyState icon="happy-outline" title="Child not found" message="This child is not in your family any more." actionLabel="Back to Settings" onAction={() => router.replace(routes.settings as Href)} />
      </Screen>
    );
  }
  return <ChildForm key={child?.id ?? 'new'} child={child} canEdit={me.role === 'parent'} />;
}

function ChildForm({ child, canEdit }: { child: Child | undefined; canEdit: boolean }) {
  const t = useTheme();
  const toast = useToast();
  const { refreshMe } = useSession();
  const isNew = !child;
  const [name, setName] = useState(child?.name ?? '');
  const [birthdate, setBirthdate] = useState(child?.birthdate ?? '');
  const [info, setInfo] = useState<ChildInfo>(() => ({ ...(child?.info ?? {}) }));
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // keys the web portal doesn't know about (e.g. added through the API) are kept and shown too
  const extraKeys = Object.keys(child?.info ?? {}).filter((k) => !KNOWN.has(k));

  const setField = (k: string, v: string) => setInfo((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setError(null);
    if (!name.trim()) { setNameError('Enter a name'); return; }
    const cleaned = Object.fromEntries(Object.entries(info).map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v));
    try {
      let childId = child?.id;
      if (isNew) {
        const r = await api.post<IdResponse>('/api/children', { name: name.trim(), birthdate: birthdate || undefined });
        childId = r.id;
        if (Object.keys(cleaned).length) await api.put<OkResponse>(`/api/children/${childId}`, { info: cleaned });
      } else {
        await api.put<OkResponse>(`/api/children/${childId}`, { name: name.trim(), birthdate: birthdate || undefined, info: cleaned });
      }
      try { await refreshMe(); } catch { /* saved; settings refreshes on open */ }
      toast.show(isNew ? `${name.trim()} added` : 'Saved', { tone: 'ok' });
      if (router.canGoBack()) router.back(); else router.replace(routes.settings as Href);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const title = isNew ? 'Add child' : child.name;
  const footer = canEdit ? <Button title={isNew ? 'Add child' : 'Save'} variant="primary" block onPress={save} testID="child-save" /> : undefined;

  return (
    <Screen headerTitle={title} footer={footer} testID="child-screen">
      {!canEdit ? <Callout tone="warn">View only: the parents keep this information up to date.</Callout> : null}
      <Section title="Child">
        <Card>
          <Field
            label="Name"
            value={name}
            onChangeText={(v) => { setName(v); if (nameError) setNameError(null); }}
            editable={canEdit}
            inputStyle={canEdit ? undefined : { backgroundColor: t.colors.soft }}
            autoCapitalize="words"
            error={nameError}
            testID="child-name"
          />
          {canEdit ? (
            <DateField label="Birthdate" value={birthdate} onChange={setBirthdate} optional={isNew} testID="child-birthdate" />
          ) : (
            <Field label="Birthdate" value={birthdate ? fmtDate(birthdate) : 'Not set'} editable={false} inputStyle={{ backgroundColor: t.colors.soft }} />
          )}
          {!isNew && birthdate && canEdit ? <AppText variant="footnote" tone="muted" style={{ marginTop: -8 }}>A birthdate can be changed but not removed.</AppText> : null}
        </Card>
      </Section>
      <Section title="Shared info" footer="Both parents (and view-only members) can see this. Every change is recorded in the activity log.">
        <Card>
          {[...INFO_FIELDS, ...extraKeys.map((key) => ({ key, placeholder: undefined, multiline: true }))].map((f) => {
            const Input = f.multiline ? TextArea : Field;
            return (
              <Input
                key={f.key}
                label={f.key}
                value={info[f.key] ?? ''}
                onChangeText={(v) => setField(f.key, v)}
                editable={canEdit}
                placeholder={canEdit ? f.placeholder : undefined}
                inputStyle={[f.multiline ? { minHeight: 64 } : null, canEdit ? null : { backgroundColor: t.colors.soft }]}
                testID={`child-info-${f.key.replace(/[^a-z]/gi, '').toLowerCase()}`}
              />
            );
          })}
        </Card>
      </Section>
      {error ? <Callout tone="bad">{error}</Callout> : null}
    </Screen>
  );
}
