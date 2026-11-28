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
  utcToLocalDate, ymd, isRealDate, isRealTime, isRealLocal, localStampToUtc, parseTime,
} from './time.js';

const LAYER = { default: 0, pattern: 1000, holiday: 2000, override: 3000 };
export const ACTIVE_STATUSES = new Set(['active', 'unconfirmed']);

/**
 * Size limits. They keep one request from tying up the server (the engine runs on the single event loop)
 * and are far above what a real custody order needs.
 */
export const LIMITS = {
  cycleDays: 56,          // longest repeating cycle
  segments: 64,           // time blocks in one pattern
  periods: 100,           // periods in one change request
  periodDays: 400,        // longest single change period
  holidayOffset: 60,      // |days| a holiday may start before / end after its date
  onceDays: 400,          // longest one-time holiday period
  priority: 500,          // |priority| within a layer (layers are 1000 apart)
  intervals: 100000,      // expanded blocks per timeline computation
};

/** Thrown when a timeline would need more than LIMITS.intervals blocks (the API turns it into a 400). */
export class ScheduleTooComplex extends Error {
  constructor() { super('This schedule is too complex to show for that period. Choose a shorter period.'); this.code = 'schedule_too_complex'; }
}
const clampPrio = (p) => Math.max(-LIMITS.priority, Math.min(LIMITS.priority, Number.isInteger(p) ? p : 0));

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

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = Number.isInteger;

export function validatePattern(cfg, parentIds) {
  if (!isObj(cfg)) throw new Error('Pattern needs a configuration');
  if (!isRealDate(cfg.anchorDate)) throw new Error('Pattern needs an anchor date');
  if (!isInt(cfg.cycleDays) || cfg.cycleDays < 1 || cfg.cycleDays > LIMITS.cycleDays) throw new Error(`Cycle must be 1-${LIMITS.cycleDays} days`);
  if (!Array.isArray(cfg.segments) || !cfg.segments.length) throw new Error('Pattern has no time blocks');
  if (cfg.segments.length > LIMITS.segments) throw new Error(`A pattern can have at most ${LIMITS.segments} time blocks`);
  const maxDay = cfg.cycleDays * 2;
  for (const s of cfg.segments) {
    if (!isObj(s)) throw new Error('Bad time block in pattern');
    if (!parentIds.includes(s.parent)) throw new Error('Pattern references an unknown parent');
    if (!isRealTime(s.startTime) || !isRealTime(s.endTime)) throw new Error('Bad time in pattern');
    if (!isInt(s.startDay) || !isInt(s.endDay) || s.startDay < 0 || s.endDay < 0 || s.startDay > maxDay || s.endDay > maxDay) {
      throw new Error(`Pattern block days must be whole numbers from 0 to ${maxDay}`);
    }
    const start = s.startDay * 1440 + toMin(s.startTime), end = s.endDay * 1440 + toMin(s.endTime);
    if (end <= start) throw new Error('A pattern block ends before it starts');
  }
  if (cfg.effectiveFrom && !isRealDate(cfg.effectiveFrom)) throw new Error('Bad effective-from date');
  if (cfg.effectiveTo && !isRealDate(cfg.effectiveTo)) throw new Error('Bad effective-to date');
  if (cfg.effectiveFrom && cfg.effectiveTo && cfg.effectiveTo < cfg.effectiveFrom) throw new Error('The effective-to date is before the effective-from date');
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

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthDay = (m, d) => isInt(m) && m >= 1 && m <= 12 && isInt(d) && d >= 1 && d <= MONTH_DAYS[m - 1];

export function validateHoliday(cfg, parentIds) {
  if (!isObj(cfg)) throw new Error('Holiday needs a configuration');
  const rule = cfg.rule;
  if (!isObj(rule) || !rule.type) throw new Error('Holiday needs a date rule');
  switch (rule.type) {
    case 'fixed': if (!monthDay(rule.month, rule.day)) throw new Error('Holiday needs a valid month and day'); break;
    case 'nth_weekday':
      if (!isInt(rule.month) || rule.month < 1 || rule.month > 12 || !isInt(rule.weekday) || rule.weekday < 0 || rule.weekday > 6
        || !(rule.n === -1 || (isInt(rule.n) && rule.n >= 1 && rule.n <= 5))) throw new Error('Holiday needs a valid month, weekday and week number');
      break;
    case 'easter': break;
    case 'range':
      if (!monthDay(rule.startMonth, rule.startDay) || !monthDay(rule.endMonth, rule.endDay)) throw new Error('Holiday period needs valid start and end dates');
      break;
    case 'once':
      if (!isRealDate(rule.startDate) || (rule.endDate && !isRealDate(rule.endDate))) throw new Error('One-time period needs valid dates');
      if (rule.endDate && (rule.endDate < rule.startDate || diffDays(rule.endDate, rule.startDate) > LIMITS.onceDays)) {
        throw new Error(`A one-time period must end on or after its start, within ${LIMITS.onceDays} days`);
      }
      break;
    default: throw new Error(`Unknown holiday rule type: ${rule.type}`);
  }
  for (const k of ['start', 'end']) {
    const b = cfg[k];
    if (!isObj(b) || !isInt(b.dayOffset) || !isRealTime(b.time)) throw new Error(`Holiday ${k} needs a day offset and time`);
    if (Math.abs(b.dayOffset) > LIMITS.holidayOffset) throw new Error(`Holiday day offsets must be within ${LIMITS.holidayOffset} days`);
  }
  // The block must end after it starts (checked on a sample year; 'once' uses its own year).
  const year = rule.type === 'once' ? parseDate(rule.startDate).y : 2028;
  const occ = holidayOccurrence(rule, year);
  if (occ) {
    const a = addDays(occ.startDate, cfg.start.dayOffset) + 'T' + cfg.start.time, b = addDays(occ.endDate, cfg.end.dayOffset) + 'T' + cfg.end.time;
    if (b <= a) throw new Error('A holiday block ends before it starts');
  }
  const a = isObj(cfg.assignment) ? cfg.assignment : {};
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
  if (!isObj(cfg) || !Array.isArray(cfg.periods) || !cfg.periods.length) throw new Error('Change request needs at least one period');
  if (cfg.periods.length > LIMITS.periods) throw new Error(`A change request can have at most ${LIMITS.periods} periods`);
  for (const p of cfg.periods) {
    if (!isObj(p) || !isRealLocal(p.start) || !isRealLocal(p.end)) throw new Error('Change request periods need start and end date/times');
    if (p.end <= p.start) throw new Error('A change period ends before it starts');
    if (diffDays(p.end.slice(0, 10), p.start.slice(0, 10)) > LIMITS.periodDays) throw new Error(`A change period can be at most ${LIMITS.periodDays} days`);
    if (!parentIds.includes(p.parent)) throw new Error('Change request assigned to unknown parent');
  }
}

export function validateDefault(cfg, parentIds) {
  if (!isObj(cfg) || !parentIds.includes(cfg.parent)) throw new Error('Default custody must be assigned to a parent');
}

// ---------- Expansion ----------

/**
 * Expand one rule into concrete UTC intervals overlapping [fromMs, toMs).
 * A rule that has ended (ended_at, epoch ms) only produces time before that moment.
 * `budget.left` counts down per generated block; ScheduleTooComplex is thrown when it runs out.
 */
export function expandRule(rule, tz, fromMs, toMs, budget = { left: LIMITS.intervals }) {
  const cfg = rule.config;
  const out = [];
  const src = { type: rule.type, id: rule.id, name: rule.name };
  const prio = LAYER[rule.type] + clampPrio(rule.priority || 0);
  const cap = rule.ended_at ?? Infinity;
  const spend = () => { if (--budget.left < 0) throw new ScheduleTooComplex(); };
  const push = (start, end, parent) => {
    end = Math.min(end, cap);
    if (end > fromMs && start < toMs && end > start) out.push({ start, end, parent, prio, order: rule.id, src });
  };
  if (cap <= fromMs) return out;

  if (rule.type === 'pattern') {
    const fromDate = addDays(utcToLocalDate(fromMs, tz), -cfg.cycleDays * 2 - 1);
    const toDate = addDays(utcToLocalDate(Math.min(toMs, cap), tz), 1);
    // A pattern never applies before it starts: entering a schedule today must not rewrite history.
    // To enter an older order, set the anchor (or effectiveFrom) to the order's start date.
    const effFromDate = cfg.effectiveFrom || cfg.anchorDate;
    const effFrom = localToUtc(effFromDate, '00:00', tz);
    const effTo = cfg.effectiveTo ? localToUtc(addDays(cfg.effectiveTo, 1), '00:00', tz) : Infinity;
    const lastDay = Math.max(...cfg.segments.map(s => s.endDay)) + 1;
    let k = Math.floor(diffDays(fromDate, cfg.anchorDate) / cfg.cycleDays);
    for (;; k++) {
      const cycleStart = addDays(cfg.anchorDate, k * cfg.cycleDays);
      if (cycleStart > toDate) break;
      if (addDays(cycleStart, lastDay) < effFromDate) continue; // the whole cycle is before the pattern starts
      if (localToUtc(cycleStart, '00:00', tz) >= effTo) break;
      for (const s of cfg.segments) {
        spend();
        const a = localToUtc(addDays(cycleStart, s.startDay), s.startTime, tz);
        const b = localToUtc(addDays(cycleStart, s.endDay), s.endTime, tz);
        push(Math.max(a, effFrom), Math.min(b, effTo), s.parent);
      }
    }
  } else if (rule.type === 'holiday') {
    const y0 = parseDate(utcToLocalDate(fromMs, tz)).y - 1;
    const y1 = parseDate(utcToLocalDate(toMs, tz)).y;
    for (let y = y0; y <= y1; y++) {
      spend();
      const occ = holidayOccurrence(cfg.rule, y);
      if (!occ) continue;
      const a = localToUtc(addDays(occ.startDate, cfg.start.dayOffset), cfg.start.time, tz);
      const b = localToUtc(addDays(occ.endDate, cfg.end.dayOffset), cfg.end.time, tz);
      push(a, b, holidayParent(cfg, y));
    }
  } else if (rule.type === 'override') {
    for (const p of cfg.periods) { spend(); push(localStampToUtc(p.start, tz), localStampToUtc(p.end, tz), p.parent); }
  }
  return out;
}

/** A rule is in force if it is active / not yet confirmed, or it has ended (then only before ended_at). */
export const inForce = (r) => ACTIVE_STATUSES.has(r.status) || (r.status === 'retired' && r.ended_at != null);

const DEFAULT_NAME = 'Default (primary parent)';

/**
 * Resolve the rules in force into a non-overlapping timeline for [fromMs, toMs).
 * Returns [{start, end, parent, src}] (UTC ms), contiguous and merged.
 *
 * History is preserved: an item that was ended (or replaced) keeps applying before the moment it ended
 * (rules.ended_at), and a primary-parent (default) rule applies from the moment it took effect
 * (rules.effective_from; the family's first one from the beginning of time) until it was replaced.
 *
 * Sweep line over the sorted block boundaries with a max-heap of the blocks in force, keyed by
 * (layer + priority, newer rule, earlier block): O((n + m) log n) for n blocks and m boundaries.
 */
export function buildTimeline({ rules, tz, fromMs, toMs, extraRules = [], excludeRuleIds = [], budget = LIMITS.intervals }) {
  const excluded = new Set(excludeRuleIds);
  const rulesInForce = rules.filter(r => inForce(r) && !excluded.has(r.id)).concat(extraRules);
  const b = { left: budget };

  const intervals = [];
  rulesInForce.filter(r => r.type === 'default').sort((x, y) => x.id - y.id).forEach((r, i) => {
    const start = i === 0 ? -Infinity : (r.effective_from ?? -Infinity);
    const end = r.ended_at ?? Infinity;
    if (end > fromMs && start < toMs && end > start) {
      intervals.push({ start, end, parent: r.config.parent, prio: -Infinity, order: r.id, src: { type: 'default', id: r.id, name: DEFAULT_NAME } });
    }
  });
  for (const r of rulesInForce) if (r.type !== 'default') for (const iv of expandRule(r, tz, fromMs, toMs, b)) intervals.push(iv);

  const pts = [fromMs, toMs];
  const items = [];
  for (const iv of intervals) {
    const s = Math.max(iv.start, fromMs), e = Math.min(iv.end, toMs);
    if (e <= s) continue;
    items.push({ s, e, iv, idx: items.length });
    if (s > fromMs) pts.push(s);
    if (e < toMs) pts.push(e);
  }
  const sorted = [...new Set(pts)].sort((x, y) => x - y);
  items.sort((x, y) => x.s - y.s || x.idx - y.idx);
  const heap = new MaxHeap((x, y) => x.iv.prio > y.iv.prio || (x.iv.prio === y.iv.prio && (x.iv.order > y.iv.order || (x.iv.order === y.iv.order && x.idx < y.idx))));

  const out = [];
  let p = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], bEnd = sorted[i + 1];
    while (p < items.length && items[p].s <= a) heap.push(items[p++]);
    while (heap.size && heap.top().e <= a) heap.pop();
    const best = heap.size ? heap.top().iv : null;
    const parent = best ? best.parent : null;
    const src = best ? best.src : { type: 'default', id: null, name: DEFAULT_NAME };
    const last = out[out.length - 1];
    if (last && last.parent === parent && last.src.id === src.id && last.src.type === src.type) last.end = bEnd;
    else out.push({ start: a, end: bEnd, parent, src });
  }
  return out;
}

/** Binary max-heap; `better(a, b)` is true when a should come out before b. */
class MaxHeap {
  constructor(better) { this.a = []; this.better = better; }
  get size() { return this.a.length; }
  top() { return this.a[0]; }
  push(x) {
    const a = this.a; a.push(x);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.better(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.better(a[l], a[m])) m = l;
        if (r < a.length && this.better(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
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
  let nights = 0, p = 0;
  // The timeline is sorted and the 2:00 AM instants increase, so one pointer walks both.
  for (let d = fromDate; d < toDateExclusive; d = addDays(d, 1)) {
    const t = localToUtc(d, '02:00', tz);
    while (p < timeline.length && timeline[p].end <= t) p++;
    const iv = p < timeline.length && timeline[p].start <= t ? timeline[p] : null;
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

/** Who has the children at `ms` (binary search; the timeline is sorted and non-overlapping). */
export function ownerAt(timeline, ms) {
  let lo = 0, hi = timeline.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, iv = timeline[mid];
    if (iv.end <= ms) lo = mid + 1;
    else if (iv.start > ms) hi = mid - 1;
    else return iv.parent;
  }
  return null;
}

export { dayOfWeek };
