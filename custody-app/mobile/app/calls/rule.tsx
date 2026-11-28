import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Callout, EmptyState, Field, HeaderButton, MultiSelect, Screen, Select, TextArea, TimeField, useAttempt } from '@/components/ui';
import { METHOD_OPTIONS, PERIOD_OPTIONS } from '@/components/calls/format';
import { SegmentedField } from '@/components/calls/SegmentedField';
import { api } from '@/lib/api';
import { DAYS } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import type { CallMethod, CallPeriod, IdResponse } from '@/lib/types';

const DAY_OPTIONS = DAYS.map((d, i) => ({ value: i, label: d }));

/**
 * New call / video schedule (iOS sheet). With a co-parent it is sent for approval; alone it
 * is saved as "not yet confirmed" until the co-parent joins and approves it.
 */
export default function CallRuleScreen() {
  const { myId, isParent, other, parentOptions } = usePeople();
  const attempt = useAttempt();
  const [name, setName] = useState('');
  const [entitled, setEntitled] = useState<number>(myId);
  const [method, setMethod] = useState<CallMethod>('either');
  const [count, setCount] = useState('2');
  const [period, setPeriod] = useState<CallPeriod>('week');
  const [duration, setDuration] = useState('15');
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('20:00');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ count?: string; duration?: string; window?: string }>({});
  const [busy, setBusy] = useState(false);
  const submitLabel = other ? 'Send for approval' : 'Save';

  const save = async () => {
    if (busy) return;
    const e: typeof errors = {};
    const n = Number(count);
    if (!/^\d+$/.test(count) || n < 1 || n > 50) e.count = 'Calls per period must be 1-50';
    const dur = Number(duration || 0);
    if (duration && (!/^\d+$/.test(duration) || dur > 600)) e.duration = '0-600 minutes';
    if (start && end && end <= start) e.window = 'The window must end after it starts';
    setErrors(e);
    if (e.count || e.duration || e.window) return;
    setBusy(true);
    try {
      const r = await attempt(() => api.post<IdResponse>('/api/call-rules', {
        name: name.trim() || undefined,
        entitled_parent: entitled,
        method,
        count: n,
        period,
        duration_min: dur,
        reason,
        window: { days: [...days].sort((a, b) => a - b), start: start || null, end: end || null },
      }), other ? 'Sent for approval' : 'Saved');
      if (r) router.back();
    } finally {
      setBusy(false);
    }
  };

  if (!isParent) {
    return (
      <Screen headerTitle="Call schedule">
        <EmptyState icon="eye-outline" title="View only" message="Only parents can add call schedules." />
      </Screen>
    );
  }

  return (
    <Screen headerTitle="Call schedule" headerRight={() => <HeaderButton title={other ? 'Send' : 'Save'} bold onPress={save} disabled={busy} testID="header-save" />} testID="call-rule-screen">
      <Callout tone="accent">Usually the parent without custody at that moment gets calls with the children. Enter what your order says.</Callout>
      <Field label="Name (optional)" value={name} onChangeText={setName} placeholder="e.g. Weeknight video calls" maxLength={120} testID="rule-name" />
      <Select label="Calls are for" value={entitled} options={parentOptions} onChange={setEntitled} testID="rule-entitled" />
      <SegmentedField label="Type (phone, video or either)" options={METHOD_OPTIONS} value={method} onChange={setMethod} testID="rule-method" />
      <View style={styles.pair}>
        <Field
          label="How many"
          value={count}
          onChangeText={(v) => { setCount(v.replace(/[^\d]/g, '')); if (errors.count) setErrors({ ...errors, count: undefined }); }}
          keyboardType="number-pad"
          maxLength={2}
          error={errors.count}
          style={styles.half}
          testID="rule-count"
        />
        <Field
          label="Minimum minutes"
          value={duration}
          onChangeText={(v) => { setDuration(v.replace(/[^\d]/g, '')); if (errors.duration) setErrors({ ...errors, duration: undefined }); }}
          keyboardType="number-pad"
          maxLength={3}
          placeholder="0"
          error={errors.duration}
          style={styles.half}
          testID="rule-duration"
        />
      </View>
      <SegmentedField label="Per" options={PERIOD_OPTIONS} value={period} onChange={setPeriod} testID="rule-period" />
      <MultiSelect label="Allowed days" hint="None selected = any day" options={DAY_OPTIONS} values={days} onChange={setDays} />
      <View style={styles.pair}>
        <View style={styles.half}>
          <TimeField label="Window from" value={start} onChange={(v) => { setStart(v); if (errors.window) setErrors({ ...errors, window: undefined }); }} optional testID="rule-start" />
        </View>
        <View style={styles.half}>
          <TimeField label="Window until" value={end} onChange={(v) => { setEnd(v); if (errors.window) setErrors({ ...errors, window: undefined }); }} optional error={errors.window} testID="rule-end" />
        </View>
      </View>
      <TextArea label="Order reference" value={reason} onChangeText={setReason} placeholder="e.g. Parenting plan §4.2: two video calls per week, 6-8 PM" maxLength={2000} testID="rule-reason" />
      <Button title={submitLabel} variant="primary" block onPress={save} loading={busy} testID="rule-save" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
});
