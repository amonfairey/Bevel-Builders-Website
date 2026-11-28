import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { AppText, Button, DateTimeField, EmptyState, ErrorView, Field, HeaderButton, Loading, MultiSelect, Screen, Select, TextArea, useAttempt, type Option } from '@/components/ui';
import { SegmentedField } from '@/components/calls/SegmentedField';
import { api } from '@/lib/api';
import { isLocalStamp, nowLocalStamp } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { CALL_STATUS } from '@/lib/status';
import type { CallRule, CallStatus, IdResponse } from '@/lib/types';

const STATUS_OPTIONS: Option<CallStatus>[] = CALL_STATUS.map(([value, label]) => ({ value: value as CallStatus, label }));
const METHODS: Option<'phone' | 'video'>[] = [{ value: 'phone', label: 'Phone' }, { value: 'video', label: 'Video' }];

/** Log a call (iOS sheet): which schedule, when, how long, phone/video, what happened, children, details. */
export default function LogCallScreen() {
  const { me, tz, isParent } = usePeople();
  const attempt = useAttempt();
  const rulesQ = useApi<CallRule[]>('/api/call-rules');
  const activeRules = (rulesQ.data ?? []).filter((r) => r.status === 'active' || r.status === 'unconfirmed');

  const [ruleId, setRuleId] = useState<number | null | undefined>(undefined);
  const [started, setStarted] = useState(() => nowLocalStamp(tz));
  const [minutes, setMinutes] = useState('');
  const [method, setMethod] = useState<'phone' | 'video'>('video');
  const [status, setStatus] = useState<CallStatus>('completed');
  const [kids, setKids] = useState<number[]>(() => me.children.map((c) => c.id));
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<{ started?: string; minutes?: string }>({});
  const [busy, setBusy] = useState(false);

  // Default to the first active schedule once they load (like the web form).
  const firstRule = activeRules[0]?.id ?? null;
  const loaded = rulesQ.data !== undefined;
  useEffect(() => {
    if (loaded && ruleId === undefined) setRuleId(firstRule);
  }, [loaded, firstRule, ruleId]);

  const save = async () => {
    if (busy) return;
    const e: typeof errors = {};
    if (!isLocalStamp(started)) e.started = 'Enter when the call was (or was supposed to be)';
    if (minutes.trim() && !/^\d+$/.test(minutes.trim())) e.minutes = 'Whole minutes, e.g. 15';
    setErrors(e);
    if (e.started || e.minutes) return;
    setBusy(true);
    try {
      const r = await attempt(() => api.post<IdResponse>('/api/calls', {
        rule_id: ruleId ?? null, started, duration_min: Number(minutes.trim() || 0), status, method, details, child_ids: kids,
      }), 'Logged');
      if (r) router.back();
    } finally {
      setBusy(false);
    }
  };

  if (!isParent) {
    return (
      <Screen headerTitle="Log a call">
        <EmptyState icon="eye-outline" title="View only" message="Only parents can log calls." />
      </Screen>
    );
  }
  if (!loaded) {
    return (
      <Screen headerTitle="Log a call">
        {rulesQ.error ? <ErrorView message={rulesQ.error.message} onRetry={rulesQ.reload} /> : <Loading />}
      </Screen>
    );
  }

  const ruleOptions: Option<number | null>[] = [
    { value: null, label: 'Not under a schedule' },
    ...activeRules.map((r) => ({ value: r.id, label: r.name, hint: `For ${r.entitled_name}` })),
  ];

  return (
    <Screen headerTitle="Log a call" headerRight={() => <HeaderButton title="Save" bold onPress={save} disabled={busy} testID="header-save" />} testID="log-call-screen">
      <Select label="Call schedule" value={ruleId ?? null} options={ruleOptions} onChange={setRuleId} testID="call-rule-select" />
      <DateTimeField label="When (scheduled or actual)" value={started} onChange={setStarted} error={errors.started} testID="call-started" />
      <Field
        label="Minutes"
        value={minutes}
        onChangeText={(v) => { setMinutes(v.replace(/[^\d]/g, '')); if (errors.minutes) setErrors({ ...errors, minutes: undefined }); }}
        placeholder="0"
        keyboardType="number-pad"
        maxLength={4}
        error={errors.minutes}
        testID="call-minutes"
      />
      <SegmentedField label="Type" options={METHODS} value={method} onChange={setMethod} testID="call-method" />
      <Select label="What happened" value={status} options={STATUS_OPTIONS} onChange={setStatus} testID="call-status-select" />
      {me.children.length ? (
        <MultiSelect label="Children" options={me.children.map((c) => ({ value: c.id, label: c.name }))} values={kids} onChange={setKids} />
      ) : null}
      <TextArea
        label="Details"
        value={details}
        onChangeText={setDetails}
        placeholder='Facts only: e.g. "Called 6:30pm, no answer. Texted at 6:35. Call back at 7:10, 12 minutes."'
        maxLength={2000}
        testID="call-details"
      />
      <AppText variant="footnote" tone="muted" style={{ marginBottom: 16 }}>
        The other parent is notified and can agree or dispute this log. Logs can't be edited afterwards.
      </AppText>
      <Button title="Save" variant="primary" block onPress={save} loading={busy} testID="call-save" />
    </Screen>
  );
}
