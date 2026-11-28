import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Callout, DateField, Field, Row, Screen, Section, Segmented, Select, TextArea, TimeField } from '@/components/ui';
import { ApprovalNotice, FormError, SubmitButton, ViewOnlyScreen, toInt, useRuleSubmit } from '@/components/schedule/form';
import { holidayWho, nextHolidayWindow, periodText } from '@/components/schedule/summary';
import { DAYS_LONG, MONTHS, daysInMonth, isDate, todayLocal } from '@/lib/format';
import { useApi, usePeople } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import type { HolidayAssignment, HolidayConfig, HolidayDateRule, HolidayPreset } from '@/lib/types';

type RType = HolidayDateRule['type'];
type Mode = 'alternate' | 'fixed';

const RTYPE_OPTIONS: { value: RType; label: string }[] = [
  { value: 'fixed', label: 'Same date every year' },
  { value: 'nth_weekday', label: 'Nth weekday of a month' },
  { value: 'easter', label: 'Easter' },
  { value: 'range', label: 'Date range every year (e.g. summer)' },
  { value: 'once', label: "One-time dates (e.g. this year's spring break)" },
];
const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: i + 1, label: m }));
const WEEKDAY_OPTIONS = DAYS_LONG.map((d, i) => ({ value: i, label: d }));
const N_OPTIONS = [{ value: 1, label: '1st' }, { value: 2, label: '2nd' }, { value: 3, label: '3rd' }, { value: 4, label: '4th' }, { value: -1, label: 'Last' }];

/**
 * Holiday or vacation period: a date rule (fixed date, Nth weekday, Easter, yearly range,
 * one-time dates), start/end offsets and times, and who has the children (alternating by
 * year or always the same parent), with a priority for overlaps.
 */
export default function HolidayScreen() {
  const t = useTheme();
  const { tz, isParent, parentOptions, nameOf } = usePeople();
  const { submit, error, fail, submitLabel } = useRuleSubmit();
  const presetsQ = useApi<HolidayPreset[]>('/api/holiday-presets');
  const p0 = parentOptions[0]?.value ?? 0;
  const p1 = parentOptions[1]?.value ?? p0;

  const [preset, setPreset] = useState('');
  const [name, setName] = useState('');
  const [rtype, setRtype] = useState<RType>('fixed');
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState('1');
  const [n, setN] = useState(1);
  const [weekday, setWeekday] = useState(1);
  const [startMonth, setStartMonth] = useState(6);
  const [startDay, setStartDay] = useState('15');
  const [endMonth, setEndMonth] = useState(8);
  const [endDay, setEndDay] = useState('15');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startBefore, setStartBefore] = useState('0');
  const [startTime, setStartTime] = useState('09:00');
  const [endAfter, setEndAfter] = useState('0');
  const [endTime, setEndTime] = useState('19:00');
  const [mode, setMode] = useState<Mode>('alternate');
  const [parent, setParent] = useState<number>(p0);
  const [evenYears, setEvenYears] = useState<number>(p0);
  const [oddYears, setOddYears] = useState<number>(p1);
  const [priority, setPriority] = useState('0');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!isParent) return <ViewOnlyScreen headerTitle="Holiday or period" />;

  const applyPreset = (key: string) => {
    setPreset(key);
    const p = presetsQ.data?.find((x) => x.key === key);
    if (!p) return;
    const r = p.rule;
    setName(p.name);
    setRtype(r.type);
    if (r.type === 'fixed') { setMonth(r.month); setDay(String(r.day)); }
    if (r.type === 'nth_weekday') { setMonth(r.month); setWeekday(r.weekday); setN(r.n); }
    if (r.type === 'range') { setStartMonth(r.startMonth); setStartDay(String(r.startDay)); setEndMonth(r.endMonth); setEndDay(String(r.endDay)); }
    const isRange = r.type === 'range';
    const thanksgiving = p.key === 'thanksgiving';
    setStartTime(isRange || thanksgiving ? '18:00' : '09:00');
    setEndTime(isRange || thanksgiving ? '18:00' : '19:00');
    setStartBefore(thanksgiving ? '1' : '0');
    setEndAfter(thanksgiving ? '3' : '0');
    setPriority(isRange ? '-10' : '0');
    setErrors({});
  };

  /** Build the config, or return field errors. */
  const build = (): { config?: HolidayConfig; errs: Record<string, string> } => {
    const errs: Record<string, string> = {};
    const dayNum = (v: string, m: number, k: string) => {
      const d = toInt(v);
      if (d == null || d < 1 || d > daysInMonth(2024, m)) { errs[k] = `${MONTHS[m - 1]} has days 1–${daysInMonth(2024, m)}`; return 1; }
      return d;
    };
    let rule: HolidayDateRule;
    if (rtype === 'fixed') rule = { type: 'fixed', month, day: dayNum(day, month, 'day') };
    else if (rtype === 'nth_weekday') rule = { type: 'nth_weekday', month, weekday, n };
    else if (rtype === 'easter') rule = { type: 'easter' };
    else if (rtype === 'range') rule = { type: 'range', startMonth, startDay: dayNum(startDay, startMonth, 'startDay'), endMonth, endDay: dayNum(endDay, endMonth, 'endDay') };
    else {
      if (!isDate(startDate)) errs.startDate = 'Choose the first day';
      if (endDate && isDate(startDate) && endDate < startDate) errs.endDate = 'Must be on or after the start date';
      rule = { type: 'once', startDate, endDate: endDate || startDate };
    }
    const before = toInt(startBefore), afterN = toInt(endAfter), prio = toInt(priority);
    if (before == null || before < 0 || before > 30) errs.startBefore = '0 to 30';
    if (afterN == null || afterN < 0 || afterN > 30) errs.endAfter = '0 to 30';
    if (prio == null) errs.priority = 'Enter a whole number (e.g. 0, 5 or -10)';
    if (!name.trim()) errs.name = 'Enter a name';
    const oneDay = rtype !== 'range' && (rtype !== 'once' || !endDate || endDate === startDate);
    if (before === 0 && afterN === 0 && oneDay && endTime <= startTime) errs.endTime = 'Ends before it starts on the same day';
    const assignment: HolidayAssignment = mode === 'fixed' ? { mode: 'fixed', parent } : { mode: 'alternate', evenYears, oddYears };
    if (Object.keys(errs).length) return { errs };
    return { errs, config: { rule, start: { dayOffset: -(before ?? 0), time: startTime }, end: { dayOffset: afterN ?? 0, time: endTime }, assignment } };
  };

  const send = async () => {
    const { config, errs } = build();
    setErrors(errs);
    if (!config) { fail('Fix the highlighted fields'); return; }
    await submit({ type: 'holiday', name: name.trim(), reason: reason.trim(), priority: toInt(priority) ?? 0, config });
  };

  const draft = build().config;
  const next = draft ? nextHolidayWindow(draft, todayLocal(tz)) : null;
  const clearErr = (k: string) => { if (errors[k]) setErrors((e) => ({ ...e, [k]: '' })); };
  const presetOptions = [{ value: '', label: 'Custom…' }, ...(presetsQ.data ?? []).map((p) => ({ value: p.key, label: p.name }))];
  const half = { flex: 1 } as const;

  return (
    <Screen headerTitle="Holiday or period" footer={<SubmitButton label={submitLabel} onPress={send} />} testID="schedule-holiday-screen">
      <ApprovalNotice what="this holiday" />
      <Select
        label="Start from a common holiday"
        value={preset}
        options={presetOptions}
        onChange={applyPreset}
        hint={presetsQ.error ? `Couldn't load the list: ${presetsQ.error.message}` : 'Fills in the date and usual times. You can change everything.'}
        testID="holiday-preset"
      />
      <Field label="Name" value={name} onChangeText={(v) => { setName(v); clearErr('name'); }} placeholder="e.g. Thanksgiving" error={errors.name || null} testID="holiday-name" />

      <Section title="Date">
        <Select label="Date rule" value={rtype} options={RTYPE_OPTIONS} onChange={setRtype} testID="holiday-rtype" />
        {rtype === 'fixed' ? (
          <Row gap={10} align="flex-start">
            <View style={{ flex: 2 }}><Select label="Month" value={month} options={MONTH_OPTIONS} onChange={setMonth} testID="holiday-month" /></View>
            <View style={half}><Field label="Day" value={day} onChangeText={(v) => { setDay(v); clearErr('day'); }} keyboardType="number-pad" error={errors.day || null} testID="holiday-day" /></View>
          </Row>
        ) : null}
        {rtype === 'nth_weekday' ? (
          <>
            <Row gap={10} align="flex-start">
              <View style={half}><Select label="Which" value={n} options={N_OPTIONS} onChange={setN} testID="holiday-n" /></View>
              <View style={{ flex: 2 }}><Select label="Weekday" value={weekday} options={WEEKDAY_OPTIONS} onChange={setWeekday} testID="holiday-weekday" /></View>
            </Row>
            <Select label="Month" value={month} options={MONTH_OPTIONS} onChange={setMonth} testID="holiday-month" />
          </>
        ) : null}
        {rtype === 'range' ? (
          <>
            <Row gap={10} align="flex-start">
              <View style={{ flex: 2 }}><Select label="Start month" value={startMonth} options={MONTH_OPTIONS} onChange={setStartMonth} testID="holiday-start-month" /></View>
              <View style={half}><Field label="Start day" value={startDay} onChangeText={(v) => { setStartDay(v); clearErr('startDay'); }} keyboardType="number-pad" error={errors.startDay || null} testID="holiday-start-day" /></View>
            </Row>
            <Row gap={10} align="flex-start">
              <View style={{ flex: 2 }}><Select label="End month" value={endMonth} options={MONTH_OPTIONS} onChange={setEndMonth} testID="holiday-end-month" /></View>
              <View style={half}><Field label="End day" value={endDay} onChangeText={(v) => { setEndDay(v); clearErr('endDay'); }} keyboardType="number-pad" error={errors.endDay || null} testID="holiday-end-day" /></View>
            </Row>
            <AppText variant="footnote" tone="muted" style={{ marginTop: -8, marginBottom: t.spacing.lg }}>An end before the start (Dec 20 – Jan 3) runs into the next year.</AppText>
          </>
        ) : null}
        {rtype === 'once' ? (
          <Row gap={10} align="flex-start">
            <View style={half}><DateField label="Start date" value={startDate} onChange={(v) => { setStartDate(v); clearErr('startDate'); }} error={errors.startDate || null} testID="holiday-start-date" /></View>
            <View style={half}><DateField label="End date" value={endDate} onChange={(v) => { setEndDate(v); clearErr('endDate'); }} optional hint="Optional" error={errors.endDate || null} testID="holiday-end-date" /></View>
          </Row>
        ) : null}
      </Section>

      <Section title="Times">
        <Row gap={10} align="flex-start">
          <View style={half}><Field label="Starts (days before)" value={startBefore} onChangeText={(v) => { setStartBefore(v); clearErr('startBefore'); }} keyboardType="number-pad" error={errors.startBefore || null} testID="holiday-start-before" /></View>
          <View style={half}><TimeField label="at" value={startTime} onChange={setStartTime} testID="holiday-start-time" /></View>
        </Row>
        <Row gap={10} align="flex-start">
          <View style={half}><Field label="Ends (days after)" value={endAfter} onChangeText={(v) => { setEndAfter(v); clearErr('endAfter'); }} keyboardType="number-pad" error={errors.endAfter || null} testID="holiday-end-after" /></View>
          <View style={half}><TimeField label="at" value={endTime} onChange={(v) => { setEndTime(v); clearErr('endTime'); }} error={errors.endTime || null} testID="holiday-end-time" /></View>
        </Row>
        <AppText variant="footnote" tone="muted">Example: Thanksgiving Wed 6 PM to Sun 6 PM = starts 1 day before at 6:00 PM, ends 3 days after at 6:00 PM.</AppText>
      </Section>

      <Section title="Who has the children">
        <Segmented<Mode> options={[{ value: 'alternate', label: 'Alternate years' }, { value: 'fixed', label: 'Same parent' }]} value={mode} onChange={setMode} />
        {mode === 'fixed' ? (
          <Select label="Parent" value={parent} options={parentOptions} onChange={setParent} testID="holiday-parent" />
        ) : (
          <>
            <Select label="Even years (2026, 2028…)" value={evenYears} options={parentOptions} onChange={setEvenYears} testID="holiday-even" />
            <Select label="Odd years (2027, 2029…)" value={oddYears} options={parentOptions} onChange={setOddYears} testID="holiday-odd" />
          </>
        )}
      </Section>

      <Field
        label="Priority"
        value={priority}
        onChangeText={(v) => { setPriority(v); clearErr('priority'); }}
        keyboardType="numbers-and-punctuation"
        hint="When two holidays overlap (Christmas Day inside Winter Break), the higher number wins. Periods such as summer default to -10 so single days inside them win."
        error={errors.priority || null}
        testID="holiday-priority"
      />
      <TextArea label="Reason / order reference" value={reason} onChangeText={setReason} placeholder="e.g. Per custody order, holiday schedule section" testID="holiday-reason" />

      {draft && next ? (
        <Callout tone="neutral" title="Next time this applies">{`${nameOf(next.parent)}: ${periodText(next)}${draft.assignment.mode === 'alternate' ? ` (${holidayWho(draft, nameOf)})` : ''}`}</Callout>
      ) : null}
      <FormError error={error} />
    </Screen>
  );
}
