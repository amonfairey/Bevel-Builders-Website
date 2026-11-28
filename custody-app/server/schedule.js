// Custody schedule engine.
//
// Layers, lowest to highest precedence:
//   1. default   - the primary custodial parent (the "background" owner)
//   2. pattern   - repeating cycles (alternating weekends, 2-2-3, week on/off, custom)
//   3. holiday   - yearly holidays and periods (summer, winter break), even/odd year alternation
//   4. override  - approved one-off changes / swaps (highest)
// Within a layer, higher `priority` wins, then the more recently created rule.

import {
  addDays, diffDays, dayOfWeek, easter, localToUtc, nthWeekday, parseDate,
  utcToLocalDate, ymd, isDate, isTime, isLocal, localStampToUtc, parseTime,
} from './time.js';

const LAYER = { default: 0, pattern: 1000, holiday: 2000, override: 3000 };
export const ACTIVE_STATUSES = new Set(['active', 'unconfirmed']);

// ---------- Pattern templates ----------

/** Build a pattern config from a named template. A and B are parent user ids. */
export function patternFromTemplate({ template, anchorDate, parentA, parentB, exchangeTime = '18:00', options = {} }) {
  const t = exchangeTime;
  const seg = (startDay, endDay, parent, startTime = t, endTime = t) => ({ startDay, startTime, endDay, endTime, parent });
  switch (template) {
    case 'alternating_weekends': {
      // anchorDate should be a Friday that starts B's weekend.
      const segs = [seg(0, 2, parentB, options.weekendStart || t, options.weekendEnd || t)];
      if (options.midweek) {
        // Wednesday visit each week (anchor Fri => Wed is day 5 and day 12)
        const s = options.midweekStart || '17:00', e = options.midweekEnd || '20:00';
        segs.push(seg(5, 5, parentB, s, e), seg(12, 12, parentB, s, e));
      }
      return { template, anchorDate, cycleDays: 14, segments: segs };
    }
    case 'every_weekend':
      return { template, anchorDate, cycleDays: 7, segments: [seg(0, 2, parentB, options.weekendStart || t, options.weekendEnd || t)] };
    case 'week_on_week_off':
      return { template, anchorDate, cycleDays: 14, segments: [seg(0, 7, parentA), seg(7, 14, parentB)] };
    case '2-2-3':
      return { template, anchorDate, cycleDays: 14, segments: [
        seg(0, 2, parentA), seg(2, 4, parentB), seg(4, 7, parentA),
        seg(7, 9, parentB), seg(9, 11, parentA), seg(11, 14, parentB)] };
    case '2-2-5-5':
      return { template, anchorDate, cycleDays: 14, segments: [
        seg(0, 2, parentA), seg(2, 4, parentB), seg(4, 9, parentA), seg(9, 14, parentB)] };
    case '3-4-4-3':
      return { template, anchorDate, cycleDays: 14, segments: [
        seg(0, 3, parentA), seg(3, 7, parentB), seg(7, 11, parentA), seg(11, 14, parentB)] };
    case 'custom': {
      // options.days: array of parent ids (or null = default parent), one per day of the cycle.
      const days = options.days || [];
      if (!days.length || days.length > 56) throw new Error('Custom cycle needs 1-56 days');
      const segments = [];
      let i = 0;
      while (i < days.length) {
        let j = i;
        while (j + 1 < days.length && days[j + 1] === days[i]) j++;
        if (days[i] != null) segments.push(seg(i, j + 1, days[i]));
        i = j + 1;
      }
      return { template, anchorDate, cycleDays: days.length, segments, days };
    }
    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

export function validatePattern(cfg, parentIds) {
  if (!isDate(cfg.anchorDate)) throw new Error('Pattern needs an anchor date');
  if (!(cfg.cycleDays >= 1 && cfg.cycleDays <= 56)) throw new Error('Cycle must be 1-56 days');
  if (!Array.isArray(cfg.segments) || !cfg.segments.length) throw new Error('Pattern has no time blocks');
  for (const s of cfg.segments) {
    if (!parentIds.includes(s.parent)) throw new Error('Pattern references an unknown parent');
    if (!isTime(s.startTime) || !isTime(s.endTime)) throw new Error('Bad time in pattern');
    const start = s.startDay * 1440 + toMin(s.startTime), end = s.endDay * 1440 + toMin(s.endTime);
    if (end <= start) throw new Error('A pattern block ends before it starts');
  }
  if (cfg.effectiveFrom && !isDate(cfg.effectiveFrom)) throw new Error('Bad effective-from date');
  if (cfg.effectiveTo && !isDate(cfg.effectiveTo)) throw new Error('Bad effective-to date');
}

function toMin(t) { const { h, min } = parseTime(t); return h * 60 + min; }

// ---------- Holiday rules ----------

export const HOLIDAY_PRESETS = [
  { key: 'new_year', name: "New Year's Day", rule: { type: 'fixed', month: 1, day: 1 } },
  { key: 'mlk', name: 'MLK Jr. Day', rule: { type: 'nth_weekday', month: 1, weekday: 1, n: 3 } },
  { key: 'presidents', name: "Presidents' Day", rule: { type: 'nth_weekday', month: 2, weekday: 1, n: 3 } },
  { key: 'easter', name: 'Easter Sunday', rule: { type: 'easter' } },
  { key: 'mothers_day', name: "Mother's Day", rule: { type: 'nth_weekday', month: 5, weekday: 0, n: 2 } },
  { key: 'memorial', name: 'Memorial Day', rule: { type: 'nth_weekday', month: 5, weekday: 1, n: -1 } },
  { key: 'fathers_day', name: "Father's Day", rule: { type: 'nth_weekday', month: 6, weekday: 0, n: 3 } },
  { key: 'july4', name: 'Independence Day', rule: { type: 'fixed', month: 7, day: 4 } },
  { key: 'labor', name: 'Labor Day', rule: { type: 'nth_weekday', month: 9, weekday: 1, n: 1 } },
  { key: 'halloween', name: 'Halloween', rule: { type: 'fixed', month: 10, day: 31 } },
  { key: 'thanksgiving', name: 'Thanksgiving', rule: { type: 'nth_weekday', month: 11, weekday: 4, n: 4 } },
  { key: 'christmas_eve', name: 'Christmas Eve', rule: { type: 'fixed', month: 12, day: 24 } },
  { key: 'christmas', name: 'Christmas Day', rule: { type: 'fixed', month: 12, day: 25 } },
  { key: 'winter_break', name: 'Winter Break', rule: { type: 'range', startMonth: 12, startDay: 20, endMonth: 1, endDay: 3 } },
  { key: 'summer', name: 'Summer Vacation', rule: { type: 'range', startMonth: 6, startDay: 15, endMonth: 8, endDay: 15 } },
  { key: 'birthday', name: "Child's Birthday", rule: { type: 'fixed', month: 1, day: 1 } },
];

/** Returns [{startDate, endDate}] occurrences of a holiday rule anchored in `year`. */
export function holidayOccurrence(rule, year) {
  switch (rule.type) {
    case 'fixed': return { startDate: ymd(year, rule.month, rule.day), endDate: ymd(year, rule.month, rule.day) };
    case 'nth_weekday': {
      const d = nthWeekday(year, rule.month, rule.weekday, rule.n);
      return d ? { startDate: d, endDate: d } : null;
    }
    case 'easter': { const d = easter(year); return { startDate: d, endDate: d }; }
    case 'range': {
      const startDate = ymd(year, rule.startMonth, rule.startDay);
      const wraps = rule.endMonth < rule.startMonth || (rule.endMonth === rule.startMonth && rule.endDay < rule.startDay);
      const endDate = ymd(wraps ? year + 1 : year, rule.endMonth, rule.endDay);
      return { startDate, endDate };
    }
    case 'once': {
      const y = parseDate(rule.startDate).y;
      return y === year ? { startDate: rule.startDate, endDate: rule.endDate || rule.startDate } : null;
    }
    default: throw new Error(`Unknown holiday rule type: ${rule.type}`);
  }
}

export function validateHoliday(cfg, parentIds) {
  if (!cfg.rule || !cfg.rule.type) throw new Error('Holiday needs a date rule');
  holidayOccurrence(cfg.rule, 2026); // throws on unknown type
  if (cfg.rule.type === 'once' && (!isDate(cfg.rule.startDate) || (cfg.rule.endDate && !isDate(cfg.rule.endDate)))) throw new Error('One-time period needs valid dates');
  for (const k of ['start', 'end']) {
    const b = cfg[k];
    if (!b || !Number.isInteger(b.dayOffset) || !isTime(b.time)) throw new Error(`Holiday ${k} needs a day offset and time`);
  }
  const a = cfg.assignment || {};
  if (a.mode === 'fixed') {
    if (!parentIds.includes(a.parent)) throw new Error('Holiday assigned to unknown parent');
  } else if (a.mode === 'alternate') {
    if (!parentIds.includes(a.evenYears) || !parentIds.includes(a.oddYears)) throw new Error('Alternating holiday needs both parents');
  } else throw new Error('Holiday needs an assignment (fixed or alternate)');
}

function holidayParent(cfg, year) {
  const a = cfg.assignment;
  if (a.mode === 'fixed') return a.parent;
  return year % 2 === 0 ? a.evenYears : a.oddYears;
}

export function validateOverride(cfg, parentIds) {
  if (!Array.isArray(cfg.periods) || !cfg.periods.length) throw new Error('Change request needs at least one period');
  for (const p of cfg.periods) {
    if (!isLocal(p.start) || !isLocal(p.end)) throw new Error('Change request periods need start and end date/times');
    if (p.end <= p.start) throw new Error('A change period ends before it starts');
    if (!parentIds.includes(p.parent)) throw new Error('Change request assigned to unknown parent');
  }
}

export function validateDefault(cfg, parentIds) {
  if (!parentIds.includes(cfg.parent)) throw new Error('Default custody must be assigned to a parent');
}

// ---------- Expansion ----------

/** Expand one rule into concrete UTC intervals overlapping [fromMs, toMs). */
export function expandRule(rule, tz, fromMs, toMs) {
  const cfg = rule.config;
  const out = [];
  const src = { type: rule.type, id: rule.id, name: rule.name };
  const prio = LAYER[rule.type] + (rule.priority || 0);
  const push = (start, end, parent) => {
    if (end > fromMs && start < toMs && end > start) out.push({ start, end, parent, prio, order: rule.id, src });
  };

  if (rule.type === 'pattern') {
    const fromDate = addDays(utcToLocalDate(fromMs, tz), -cfg.cycleDays - 1);
    const toDate = addDays(utcToLocalDate(toMs, tz), 1);
    // A pattern never applies before it starts: entering a schedule today must not rewrite history.
    // To enter an older order, set the anchor (or effectiveFrom) to the order's start date.
    const effFrom = localToUtc(cfg.effectiveFrom || cfg.anchorDate, '00:00', tz);
    const effTo = cfg.effectiveTo ? localToUtc(addDays(cfg.effectiveTo, 1), '00:00', tz) : Infinity;
    let k = Math.floor(diffDays(fromDate, cfg.anchorDate) / cfg.cycleDays);
    for (;; k++) {
      const cycleStart = addDays(cfg.anchorDate, k * cfg.cycleDays);
      if (cycleStart > toDate) break;
      for (const s of cfg.segments) {
        const a = localToUtc(addDays(cycleStart, s.startDay), s.startTime, tz);
        const b = localToUtc(addDays(cycleStart, s.endDay), s.endTime, tz);
        push(Math.max(a, effFrom), Math.min(b, effTo), s.parent);
      }
    }
  } else if (rule.type === 'holiday') {
    const y0 = parseDate(utcToLocalDate(fromMs, tz)).y - 1;
    const y1 = parseDate(utcToLocalDate(toMs, tz)).y;
    for (let y = y0; y <= y1; y++) {
      const occ = holidayOccurrence(cfg.rule, y);
      if (!occ) continue;
      const a = localToUtc(addDays(occ.startDate, cfg.start.dayOffset), cfg.start.time, tz);
      const b = localToUtc(addDays(occ.endDate, cfg.end.dayOffset), cfg.end.time, tz);
      push(a, b, holidayParent(cfg, y));
    }
  } else if (rule.type === 'override') {
    for (const p of cfg.periods) push(localStampToUtc(p.start, tz), localStampToUtc(p.end, tz), p.parent);
  }
  return out;
}

/**
 * Resolve all active rules into a non-overlapping timeline for [fromMs, toMs).
 * Returns [{start, end, parent, src}] (UTC ms), contiguous and merged.
 */
export function buildTimeline({ rules, tz, fromMs, toMs, extraRules = [], excludeRuleIds = [] }) {
  const active = rules.filter(r => ACTIVE_STATUSES.has(r.status) && !excludeRuleIds.includes(r.id)).concat(extraRules);
  const def = active.filter(r => r.type === 'default').sort((a, b) => b.id - a.id)[0];
  const defaultParent = def ? def.config.parent : null;
  const intervals = active.filter(r => r.type !== 'default').flatMap(r => expandRule(r, tz, fromMs, toMs));

  const points = new Set([fromMs, toMs]);
  for (const iv of intervals) {
    if (iv.start > fromMs && iv.start < toMs) points.add(iv.start);
    if (iv.end > fromMs && iv.end < toMs) points.add(iv.end);
  }
  const sorted = [...points].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    let best = null;
    for (const iv of intervals) {
      if (iv.start <= a && iv.end >= b && (!best || iv.prio > best.prio || (iv.prio === best.prio && iv.order > best.order))) best = iv;
    }
    const parent = best ? best.parent : defaultParent;
    const src = best ? best.src : { type: 'default', id: def ? def.id : null, name: 'Default (primary parent)' };
    const last = out[out.length - 1];
    if (last && last.parent === parent && last.src.id === src.id && last.src.type === src.type) last.end = b;
    else out.push({ start: a, end: b, parent, src });
  }
  return out;
}

/** Hours and overnights per parent. The overnight credited to date d = who has the children at 2:00 AM on d. */
export function timeShare(timeline, tz, fromDate, toDateExclusive) {
  const hours = {};
  let total = 0;
  for (const iv of timeline) {
    const h = (iv.end - iv.start) / 3600000;
    const key = iv.parent ?? 'unassigned';
    hours[key] = (hours[key] || 0) + h;
    total += h;
  }
  const overnights = {};
  let nights = 0;
  for (let d = fromDate; d < toDateExclusive; d = addDays(d, 1)) {
    const t = localToUtc(d, '02:00', tz);
    const iv = timeline.find(x => x.start <= t && x.end > t);
    if (!iv) continue;
    const key = iv.parent ?? 'unassigned';
    overnights[key] = (overnights[key] || 0) + 1;
    nights++;
  }
  const pct = {}, nightPct = {};
  for (const k of Object.keys(hours)) pct[k] = total ? +(100 * hours[k] / total).toFixed(1) : 0;
  for (const k of Object.keys(overnights)) nightPct[k] = nights ? +(100 * overnights[k] / nights).toFixed(1) : 0;
  return { hours, pct, overnights, nightPct, totalHours: total, totalNights: nights };
}

/** Points in time where custody changes hands. */
export function transitions(timeline) {
  const out = [];
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].parent !== timeline[i - 1].parent) {
      out.push({ at: timeline[i].start, from: timeline[i - 1].parent, to: timeline[i].parent, src: timeline[i].src });
    }
  }
  return out;
}

export function ownerAt(timeline, ms) {
  const iv = timeline.find(x => x.start <= ms && x.end > ms);
  return iv ? iv.parent : null;
}

export { dayOfWeek };
