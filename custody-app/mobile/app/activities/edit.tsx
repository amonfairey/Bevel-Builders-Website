import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import {
  AppText, Button, Callout, DateField, EmptyState, ErrorView, Field, HeaderButton, Loading, MultiSelect, Screen, Select, TextArea, TimeField, useAttempt,
  type Option,
} from '@/components/ui';
import { EVENT_CATEGORIES, REPEAT_OPTIONS, type RepeatFreq } from '@/components/activities/constants';
import { useEventInstance } from '@/components/activities/useEventInstance';
import { parseDollars } from '@/components/money/constants';
import { api } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { DAYS, dow, isDate, isTime, todayLocal } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { EventInstance, IdResponse, OkResponse } from '@/lib/types';

interface FormState {
  title: string;
  category: string;
  driver: number | null;
  kids: number[];
  date: string;
  start: string;
  end: string;
  freq: RepeatFreq;
  interval: string;
  until: string;
  byday: number[];
  location: string;
  cost: string;
  details: string;
}

function fromEvent(e: EventInstance): FormState {
  const [sd, st] = e.start_local.split('T');
  const rec = e.recurrence;
  return {
    title: e.title, category: e.category || 'activity', driver: e.transport_parent, kids: e.child_ids,
    date: sd, start: st, end: e.end_local.split('T')[1] ?? '17:00',
    freq: rec?.freq ?? '', interval: String(rec?.interval || 1), until: rec?.until ?? '', byday: rec?.byday ?? [],
    location: e.location || '', cost: e.cost_cents ? (e.cost_cents / 100).toFixed(2) : '', details: e.details || '',
  };
}

/**
 * Add or edit an activity (iOS sheet). ?id=<eventId> edits that event; for a repeating
 * event that is the whole series. ?date= is the occurrence the user came from (used to find
 * it) or, for a new activity, the prefilled date.
 */
export default function EditActivityScreen() {
  const { id, date } = useLocalSearchParams<{ id?: string; date?: string }>();
  const { me, tz, other, isParent, parentOptions } = usePeople();
  const attempt = useAttempt();
  const badges = useBadges();
  const editing = !!id;
  const inst = useEventInstance(editing ? id : undefined, date, tz);

  const [f, setF] = useState<FormState | null>(editing ? null : {
    title: '', category: 'activity', driver: null, kids: me.children.map((c) => c.id), date: isDate(date) ? date : todayLocal(tz),
    start: '16:00', end: '17:00', freq: '', interval: '1', until: '', byday: [], location: '', cost: '', details: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string | null>>>({});
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  useEffect(() => { if (editing && !f && inst.event) setF(fromEvent(inst.event)); }, [editing, f, inst.event]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((cur) => (cur ? { ...cur, [k]: v } : cur));
    setErrors((e) => ({ ...e, [k]: null }));
  };
  const close = () => (router.canGoBack() ? router.back() : router.replace(routes.activities as Href));
  const title = editing ? (inst.event?.recurrence ? 'Edit series' : 'Edit activity') : 'Add activity';

  const save = async () => {
    if (!f || busy.current) return;
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!f.title.trim()) errs.title = 'Enter a title';
    if (!isDate(f.date)) errs.date = 'Choose a date';
    if (!isTime(f.start)) errs.start = 'Choose a start time';
    if (!isTime(f.end)) errs.end = 'Choose an end time';
    else if (isTime(f.start) && f.end <= f.start) errs.end = 'End must be after the start (same day)';
    const interval = Number(f.interval);
    if (f.freq && (!Number.isInteger(interval) || interval < 1 || interval > 8)) errs.interval = '1 to 8';
    if (f.freq && f.until && isDate(f.date) && f.until < f.date) errs.until = 'Must be on or after the first date';
    const cost = f.cost.trim() ? parseDollars(f.cost) : null;
    if (f.cost.trim() && !cost) errs.cost = 'Enter an amount like 25.00, or leave it empty';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = {
      title: f.title.trim(), category: f.category, child_ids: f.kids, start: `${f.date}T${f.start}`, end: `${f.date}T${f.end}`,
      location: f.location.trim(), transport_parent: f.driver, details: f.details.trim(), cost,
      recurrence: f.freq ? {
        freq: f.freq, interval, byday: f.freq === 'weekly' ? f.byday : [], until: f.until || null,
        exdates: inst.event?.recurrence?.exdates ?? [],
      } : null,
    };
    busy.current = true;
    setSaving(true);
    try {
      const okMsg = other ? `Saved. Sent to ${other.name} to acknowledge.` : 'Saved';
      const r = editing && inst.event
        ? await attempt(() => api.put<OkResponse>(`/api/events/${inst.event!.id}`, body), okMsg)
        : await attempt(() => api.post<IdResponse>('/api/events', body), okMsg);
      if (r) { void badges.refresh(); close(); }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  if (!isParent) {
    return <Screen headerTitle={title}><EmptyState icon="eye-outline" title="View-only access" message="Only the two parents can add or change activities." /></Screen>;
  }
  if (!f) {
    return (
      <Screen headerTitle={title}>
        {inst.loading ? <Loading /> : inst.error ? <ErrorView message={inst.error.message} onRetry={inst.reload} />
          : <EmptyState icon="football-outline" title="Activity not found" message="It may have been cancelled." />}
      </Screen>
    );
  }

  const driverOptions: Option<number | null>[] = [{ value: null, label: 'Not decided' }, ...parentOptions];
  const dayOptions = DAYS.map((d, i) => ({ value: i, label: d }));
  const series = editing && !!inst.event?.recurrence;

  return (
    <Screen headerTitle={title} headerRight={() => <HeaderButton title="Save" bold onPress={save} disabled={saving} testID="activity-save-header" />} testID="activity-edit">
      {series ? <Callout tone="warn" title="Editing the whole series">Changes apply to every date of this repeating activity. To change one date only, skip it and add a one-time activity.</Callout> : null}
      {editing && other ? <Callout tone="accent">{`Saving sends the change to ${other.name} to acknowledge again.`}</Callout> : null}

      <Field label="Title" value={f.title} onChangeText={(v) => set('title', v)} placeholder="e.g. Soccer practice" error={errors.title} maxLength={200} testID="activity-title-input" />
      <Select label="Type" value={f.category} options={EVENT_CATEGORIES} onChange={(v) => set('category', v)} testID="activity-category" />
      <Select label="Who is driving" value={f.driver} options={driverOptions} onChange={(v) => set('driver', v)} testID="activity-driver" />
      {me.children.length ? (
        <MultiSelect label="Children" options={me.children.map((c) => ({ value: c.id, label: c.name }))} values={f.kids} onChange={(v) => set('kids', v)} />
      ) : null}
      <DateField label={series ? 'First date' : 'Date'} value={f.date} onChange={(v) => set('date', v)} error={errors.date}
        hint={series ? 'The date the series starts. Each occurrence uses the same times.' : undefined} testID="activity-date" />
      <TimeField label="Start" value={f.start} onChange={(v) => set('start', v)} error={errors.start} testID="activity-start" />
      <TimeField label="End" value={f.end} onChange={(v) => set('end', v)} error={errors.end} testID="activity-end" />

      <Select label="Repeats" value={f.freq} options={REPEAT_OPTIONS} testID="activity-freq"
        onChange={(v) => {
          set('freq', v);
          if (v === 'weekly' && !f.byday.length && isDate(f.date)) set('byday', [dow(f.date)]);
        }} />
      {f.freq ? (
        <>
          <Field label={`Every N ${f.freq === 'daily' ? 'days' : f.freq === 'weekly' ? 'weeks' : 'months'}`} value={f.interval}
            onChangeText={(v) => set('interval', v.replace(/[^\d]/g, '').slice(0, 1))} keyboardType="number-pad" inputMode="numeric" error={errors.interval} hint="1 to 8" testID="activity-interval" />
          <DateField label="Until (optional)" value={f.until} onChange={(v) => set('until', v)} optional min={isDate(f.date) ? f.date : undefined} error={errors.until}
            hint={f.until ? undefined : 'Not set: repeats for up to two years.'} testID="activity-until" />
          {f.freq === 'weekly' ? <MultiSelect label="Weekly on" options={dayOptions} values={f.byday} onChange={(v) => set('byday', v)} hint="None selected = the weekday of the first date." /> : null}
        </>
      ) : null}

      <Field label="Location" value={f.location} onChangeText={(v) => set('location', v)} placeholder="e.g. Lincoln Park field 3" maxLength={300} testID="activity-location" />
      <Field label="Cost (optional, $)" value={f.cost} onChangeText={(v) => set('cost', v)} placeholder="0.00" keyboardType="decimal-pad" inputMode="decimal" error={errors.cost} testID="activity-cost" />
      <TextArea label="Details" value={f.details} onChangeText={(v) => set('details', v)} placeholder="What to bring, coach contact, uniform…" maxLength={4000} testID="activity-details" />
      <Button title="Save" variant="primary" block onPress={save} loading={saving} testID="activity-save" />
      {!editing && other ? <AppText variant="footnote" tone="muted" style={{ marginTop: 10 }}>{`${other.name} will be asked to acknowledge it.`}</AppText> : null}
    </Screen>
  );
}
