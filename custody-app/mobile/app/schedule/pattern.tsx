import { useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  AppText, Button, Card, Checkbox, DateField, Field, Row, Screen, Section, Segmented, Select, ShareTable, TextArea, TimeField,
} from '@/components/ui';
import { ApprovalNotice, FormError, SubmitButton, ViewOnlyScreen, toInt, useRuleSubmit } from '@/components/schedule/form';
import { TEMPLATE_OPTIONS, isWeekendTemplate } from '@/components/schedule/summary';
import { WeekStrip } from '@/components/schedule/WeekStrip';
import { api, errorMessage } from '@/lib/api';
import { DAYS, DAYS_LONG, addDays, dow, fmtDate, isDate, todayLocal } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import type { PatternTemplate, PatternTemplateInput, PreviewResponse } from '@/lib/types';

/**
 * Regular (repeating) schedule from a template: alternating weekends (+ optional Wednesday
 * visit), every weekend, week on/off, 2-2-3, 2-2-5-5, 3-4-4-3 or a custom day-by-day cycle.
 * Preview shows the next 4 weeks and the time share before sending.
 */
export default function PatternScreen() {
  const t = useTheme();
  const { me, tz, isParent, other, parentOptions, nameOf } = usePeople();
  const { submit, error, fail, submitLabel } = useRuleSubmit();

  const today = todayLocal(tz);
  const nextFri = addDays(today, (5 - dow(today) + 7) % 7);
  const nextMon = addDays(today, (1 - dow(today) + 7) % 7);
  const primary = me.primary ?? parentOptions[0]?.value ?? me.user.id;
  const nonPrimary = parentOptions.find((p) => p.value !== primary)?.value ?? primary;

  const [template, setTemplate] = useState<PatternTemplate>('alternating_weekends');
  const [name, setName] = useState('');
  const [anchor, setAnchor] = useState(nextFri);
  const [parentA, setParentA] = useState<number>(primary);
  const [parentB, setParentB] = useState<number>(nonPrimary);
  const [weekendStart, setWeekendStart] = useState('18:00');
  const [weekendEnd, setWeekendEnd] = useState('18:00');
  const [midweek, setMidweek] = useState(false);
  const [midweekStart, setMidweekStart] = useState('17:00');
  const [midweekEnd, setMidweekEnd] = useState('20:00');
  const [exchangeTime, setExchangeTime] = useState('18:00');
  const [cycleLen, setCycleLen] = useState('14');
  const [days, setDays] = useState<string[]>(() => Array.from({ length: 14 }, () => ''));
  const [effFrom, setEffFrom] = useState('');
  const [effTo, setEffTo] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ key: string; start: string; data?: PreviewResponse; error?: string; loading?: boolean } | null>(null);

  const weekend = isWeekendTemplate(template);
  const custom = template === 'custom';
  const n = Math.max(1, Math.min(56, toInt(cycleLen) ?? 14));

  const buildTemplate = (): PatternTemplateInput => {
    const tpl: PatternTemplateInput = {
      template, anchorDate: anchor, parentA, parentB, exchangeTime,
      effectiveFrom: effFrom || null, effectiveTo: effTo || null, options: {},
    };
    if (weekend) tpl.options = { weekendStart, weekendEnd };
    if (template === 'alternating_weekends') Object.assign(tpl.options!, { midweek, midweekStart, midweekEnd });
    if (custom) tpl.options = { days: Array.from({ length: n }, (_, i) => (days[i] ? Number(days[i]) : null)) };
    return tpl;
  };
  const key = JSON.stringify(buildTemplate());

  const problems = useMemo(() => {
    const p: Record<string, string> = {};
    if (!isDate(anchor)) p.anchor = 'Choose the day the cycle starts';
    if (!custom && other && parentA === parentB) p.parents = 'Choose two different parents';
    if (template === 'alternating_weekends' && midweek && midweekEnd <= midweekStart) p.midweek = 'The visit must end after it starts';
    if (custom) {
      const len = toInt(cycleLen);
      if (len == null || len < 1 || len > 56) p.cycle = 'Enter 1 to 56 days';
      else if (!days.slice(0, len).some(Boolean)) p.cycle = 'Give at least one day to a parent';
    }
    if (effFrom && effTo && effTo < effFrom) p.effective = 'Must be on or after "Effective from"';
    return p;
  }, [anchor, custom, other, parentA, parentB, template, midweek, midweekStart, midweekEnd, cycleLen, days, effFrom, effTo]);

  if (!isParent) return <ViewOnlyScreen headerTitle="Regular schedule" />;

  const onTemplate = (tp: PatternTemplate) => {
    setTemplate(tp);
    const w = isWeekendTemplate(tp);
    if (w && (!isDate(anchor) || dow(anchor) !== 5)) setAnchor(nextFri);
    if (!w && tp !== 'custom' && (!isDate(anchor) || dow(anchor) !== 1)) setAnchor(nextMon);
  };
  const onCycleLen = (v: string) => {
    setCycleLen(v.replace(/[^0-9]/g, ''));
    const len = toInt(v);
    if (len && len >= 1 && len <= 56) setDays((d) => Array.from({ length: len }, (_, i) => d[i] ?? ''));
  };

  const anchorHint = (() => {
    const base = weekend ? "Pick the Friday that starts the weekend parent's first weekend." : custom ? 'Day 1 of the cycle.' : "Pick the Monday the cycle starts (Parent A's first day).";
    if (!isDate(anchor)) return base;
    const d = dow(anchor);
    if (weekend && d !== 5) return `${base} This date is a ${DAYS_LONG[d]}.`;
    if (!weekend && !custom && d !== 1) return `${base} This date is a ${DAYS_LONG[d]}.`;
    return base;
  })();

  const runPreview = async () => {
    const first = Object.values(problems)[0];
    if (first) { fail(first); return; }
    const start = anchor;
    setPreview({ key, start, loading: true });
    try {
      const data = await api.post<PreviewResponse>('/api/schedule/preview', { type: 'pattern', template: buildTemplate(), start, end: addDays(start, 28) });
      setPreview({ key, start, data });
    } catch (e) {
      setPreview({ key, start, error: errorMessage(e) });
    }
  };

  const send = async () => {
    const first = Object.values(problems)[0];
    if (first) { fail(first); return; }
    await submit({ type: 'pattern', name: name.trim() || undefined, reason: reason.trim(), template: buildTemplate() });
  };

  const dayOptions = [{ value: '', label: 'Default' }, ...parentOptions.map((p) => ({ value: String(p.value), label: nameOf(p.value) }))];

  return (
    <Screen headerTitle="Regular schedule" footer={<SubmitButton label={submitLabel} onPress={send} />} testID="schedule-pattern-screen">
      <ApprovalNotice what="this schedule" />
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. School-year schedule" hint="Optional. Defaults to “Regular schedule”." testID="pattern-name" />
      <Select label="Pattern" value={template} options={TEMPLATE_OPTIONS} onChange={onTemplate} testID="pattern-template" />
      <DateField label="Cycle starts on" value={anchor} onChange={setAnchor} hint={anchorHint} error={problems.anchor} testID="pattern-anchor" />

      {!custom ? (
        <>
          <Select label={weekend ? 'Weekday parent (usually the primary)' : 'Parent A (starts the cycle)'} value={parentA} options={parentOptions} onChange={setParentA} testID="pattern-parent-a" />
          <Select label={weekend ? 'Weekend parent' : 'Parent B'} value={parentB} options={parentOptions} onChange={setParentB} error={problems.parents} testID="pattern-parent-b" />
        </>
      ) : null}

      {weekend ? (
        <Row gap={10} align="flex-start">
          <View style={{ flex: 1 }}><TimeField label="Weekend starts (Fri)" value={weekendStart} onChange={setWeekendStart} testID="pattern-weekend-start" /></View>
          <View style={{ flex: 1 }}><TimeField label="Weekend ends (Sun)" value={weekendEnd} onChange={setWeekendEnd} testID="pattern-weekend-end" /></View>
        </Row>
      ) : null}

      {template === 'alternating_weekends' ? (
        <View>
          <Checkbox label="Add a weekly Wednesday visit" hint="For the weekend parent, every Wednesday." value={midweek} onChange={setMidweek} testID="pattern-midweek" />
          {midweek ? (
            <Row gap={10} align="flex-start">
              <View style={{ flex: 1 }}><TimeField label="Visit from" value={midweekStart} onChange={setMidweekStart} testID="pattern-midweek-start" /></View>
              <View style={{ flex: 1 }}><TimeField label="Visit until" value={midweekEnd} onChange={setMidweekEnd} error={problems.midweek} testID="pattern-midweek-end" /></View>
            </Row>
          ) : null}
        </View>
      ) : null}

      {!weekend && !custom ? <TimeField label="Exchange time" value={exchangeTime} onChange={setExchangeTime} hint="Hand-offs happen at this time on changeover days." testID="pattern-exchange" /> : null}

      {custom ? (
        <Section title="Days of the cycle" footer="“Default” days go to the primary parent. Exchanges happen at the exchange time.">
          <Field label="Cycle length (days)" value={cycleLen} onChangeText={onCycleLen} keyboardType="number-pad" error={problems.cycle} testID="pattern-cycle-len" />
          <TimeField label="Exchange time" value={exchangeTime} onChange={setExchangeTime} testID="pattern-exchange-custom" />
          <Card padded={false} style={{ paddingHorizontal: 12, paddingTop: 12 }}>
            {Array.from({ length: n }, (_, i) => (
              <Row key={i} gap={10} align="flex-start">
                <AppText variant="footnote" tone="muted" style={{ width: 52, marginTop: 8 }}>{isDate(anchor) ? `${DAYS[dow(addDays(anchor, i))]} ${i + 1}` : `Day ${i + 1}`}</AppText>
                <View style={{ flex: 1 }}>
                  <Segmented<string> options={dayOptions} value={days[i] ?? ''} onChange={(v) => setDays((d) => d.map((x, j) => (j === i ? v : x)))} />
                </View>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      <Row gap={10} align="flex-start">
        <View style={{ flex: 1 }}><DateField label="Effective from" value={effFrom} onChange={setEffFrom} optional hint="Optional" testID="pattern-eff-from" /></View>
        <View style={{ flex: 1 }}><DateField label="Effective until" value={effTo} onChange={setEffTo} optional hint="e.g. end of school year" error={problems.effective} testID="pattern-eff-to" /></View>
      </Row>
      <AppText variant="footnote" tone="muted" style={{ marginTop: -8, marginBottom: t.spacing.lg }}>
        A regular schedule never applies before the cycle start (or “effective from”) date. To enter an older order, set the start to the order's date.
      </AppText>

      <TextArea label="Reason / order reference" value={reason} onChangeText={setReason} placeholder="e.g. Per stipulated order, section 3" testID="pattern-reason" />

      <Section title="Preview">
        <Button title="Preview the next 4 weeks" icon="eye-outline" onPress={runPreview} block testID="pattern-preview" />
        {preview ? (
          <Card style={{ marginTop: 10 }} testID="pattern-preview-result">
            {preview.loading ? <AppText tone="muted">Calculating…</AppText> : preview.error ? <AppText tone="bad">{preview.error}</AppText> : preview.data ? (
              <View>
                {preview.key !== key ? <AppText variant="footnote" tone="warn" style={{ marginBottom: 6 }}>You changed the form since this preview. Tap Preview again.</AppText> : null}
                <AppText variant="footnote" tone="muted" style={{ marginBottom: 8 }}>{`4 weeks from ${fmtDate(preview.start)}, together with the rest of the schedule`}</AppText>
                <WeekStrip timeline={preview.data.timeline} start={preview.start} days={28} />
                <ShareTable share={preview.data.share} />
              </View>
            ) : null}
          </Card>
        ) : null}
      </Section>
      <FormError error={error} />
    </Screen>
  );
}
