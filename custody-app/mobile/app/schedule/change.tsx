import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AppText, Button, Card, DateTimeField, Field, IconButton, Row, Screen, Section, Select, TextArea } from '@/components/ui';
import { ApprovalNotice, FormError, SubmitButton, ViewOnlyScreen, useRuleSubmit } from '@/components/schedule/form';
import { periodText } from '@/components/schedule/summary';
import { isDate, isLocalStamp } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

interface PeriodRow { key: number; parent: number; start: string; end: string }

/**
 * Request a one-time change or swap: one or more periods (who has the children from/until),
 * optionally a make-up period for the other parent, and a required reason.
 * ?date=YYYY-MM-DD prefills 9:00 AM – 6:00 PM that day.
 */
export default function ScheduleChangeScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const t = useTheme();
  const { isParent, myId, other, parentOptions } = usePeople();
  const { submit, error, fail, submitLabel } = useRuleSubmit();
  const day = typeof date === 'string' && isDate(date) ? date : null;
  const [periods, setPeriods] = useState<PeriodRow[]>([{ key: 1, parent: myId, start: day ? `${day}T09:00` : '', end: day ? `${day}T18:00` : '' }]);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!isParent) return <ViewOnlyScreen headerTitle="Request a change" />;

  const update = (key: number, patch: Partial<PeriodRow>) => {
    setPeriods((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    setErrors((e) => { const n = { ...e }; delete n[`p${key}`]; return n; });
  };
  const addPeriod = () => setPeriods((ps) => {
    const last = ps[ps.length - 1];
    return [...ps, { key: Math.max(...ps.map((p) => p.key)) + 1, parent: other?.id ?? myId, start: last?.end ?? '', end: '' }];
  });
  const remove = (key: number) => setPeriods((ps) => ps.filter((p) => p.key !== key));

  const send = async () => {
    const errs: Record<string, string> = {};
    for (const p of periods) {
      if (!isLocalStamp(p.start) || !isLocalStamp(p.end)) errs[`p${p.key}`] = 'Choose when this period starts and ends';
      else if (p.end <= p.start) errs[`p${p.key}`] = 'This period ends before it starts';
    }
    if (!reason.trim()) errs.reason = 'Say briefly why you are asking';
    setErrors(errs);
    if (Object.keys(errs).length) { fail('Fix the highlighted fields'); return; }
    await submit({
      type: 'override',
      name: name.trim() || 'Schedule change',
      reason: reason.trim(),
      config: { periods: periods.map((p) => ({ parent: p.parent, start: p.start, end: p.end })) },
    });
  };

  return (
    <Screen headerTitle="Request a change" footer={<SubmitButton label={submitLabel} onPress={send} />} testID="schedule-change-screen">
      <ApprovalNotice what="this change" />
      <AppText variant="subhead" tone="muted" style={{ marginBottom: t.spacing.lg }}>
        One-time changes win over the regular schedule and holidays. Add a second period to offer make-up time for a swap.
      </AppText>

      <Field label="Title" value={name} onChangeText={setName} placeholder="e.g. Swap weekend of the 12th" testID="change-name" />

      <Section title="Periods">
        {periods.map((p, i) => (
          <Card key={p.key} testID={`change-period-${i}`}>
            <Row justify="space-between" style={{ marginTop: -6, marginBottom: 6, minHeight: 32 }}>
              <AppText variant="subhead" weight="600">{i === 0 ? 'Period 1' : `Make-up / swap period ${i + 1}`}</AppText>
              {i > 0 ? <IconButton icon="trash-outline" size={18} accessibilityLabel={`Remove period ${i + 1}`} onPress={() => remove(p.key)} testID={`change-remove-${i}`} /> : null}
            </Row>
            <Select label="Children with" value={p.parent} options={parentOptions} onChange={(v) => update(p.key, { parent: v })} testID={`change-parent-${i}`} />
            <DateTimeField label="From" value={p.start} onChange={(v) => update(p.key, { start: v })} testID={`change-start-${i}`} />
            <DateTimeField
              label="Until"
              value={p.end}
              onChange={(v) => update(p.key, { end: v })}
              min={p.start ? p.start.slice(0, 10) : undefined}
              error={errors[`p${p.key}`]}
              hint={isLocalStamp(p.start) && isLocalStamp(p.end) && p.end > p.start ? periodText(p) : undefined}
              testID={`change-end-${i}`}
            />
          </Card>
        ))}
        <Button title="Add make-up / swap period" icon="add" size="sm" onPress={addPeriod} testID="change-add-period" />
      </Section>

      <TextArea
        label="Reason"
        value={reason}
        onChangeText={(v) => { setReason(v); if (errors.reason) setErrors((e) => ({ ...e, reason: '' })); }}
        placeholder={'Brief and specific: e.g. "Work trip Dec 11–13. Offering Dec 18–20 in exchange."'}
        hint="Required. Your co-parent sees this with the request."
        error={errors.reason || null}
        testID="change-reason"
      />
      <FormError error={error} />
    </Screen>
  );
}
