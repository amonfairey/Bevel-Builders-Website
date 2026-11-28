/**
 * Response shapes of the CoParent Hub API (custody-app/server/api.js).
 *
 * Conventions used by the server:
 * - Ids are integers. Parent ids are user ids.
 * - `*_ms` and timeline/event `start`/`end` are UTC epoch milliseconds.
 * - `*_local` and form values are wall-clock strings in the FAMILY time zone:
 *   'YYYY-MM-DD' (date), 'HH:MM' (time), 'YYYY-MM-DDTHH:MM' (local stamp).
 * - `*_at` columns are ISO-8601 UTC strings (new Date().toISOString()).
 * - Money is integer cents.
 * - JSON columns (config, child_ids, recurrence, window, info, data) are already parsed.
 */

// ---------- auth / me ----------

export type Role = 'parent' | 'viewer';

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Member {
  /** user id */
  id: number;
  name: string;
  email: string;
  role: Role;
  /** hex color the clients use for this person everywhere (dots, calendar strips, share bars) */
  color: string;
}

/** Free-form child info bank. Keys used by the web portal: School, Teacher, Doctor, Dentist, Allergies, Medications, Insurance, 'Clothing / shoe size', 'Emergency contact', Other. */
export type ChildInfo = Record<string, string>;

export interface Child {
  id: number;
  name: string;
  birthdate: string | null;
  info: ChildInfo;
}

export interface Family {
  id: number;
  name: string;
  timezone: string;
  /** the caller's default share of expenses in percent (0-100) */
  default_split: number;
  /** parents only; null once the co-parent has joined */
  invite_code?: string | null;
  /** parents only */
  viewer_code?: string | null;
}

/** GET /api/me when signed out */
export interface MeSignedOut {
  user: null;
}

/** GET /api/me when signed in but not yet in a family */
export interface MeNoFamily {
  user: User;
  family: null;
  unread_notifications?: number;
}

/** GET /api/me when signed in and in a family */
export interface Me {
  user: User;
  family: Family;
  role: Role;
  members: Member[];
  children: Child[];
  /** user id of the primary (background default) parent, or null */
  primary: number | null;
  /** path of the caller's private calendar feed, e.g. '/ics/<token>.ics' (prefix with the API base URL) */
  icsBase: string;
  unread_notifications: number;
}

export type MeResponse = MeSignedOut | MeNoFamily | Me;

/** POST /api/login and /api/register with client:'mobile' */
export interface TokenResponse {
  ok: true;
  token: string;
}

export interface OkResponse {
  ok: true;
}

export interface IdResponse {
  id: number;
}

export interface PublicConfig {
  appStoreUrl: string | null;
  testflightUrl: string | null;
}

// ---------- custody rules ----------

export type RuleType = 'default' | 'pattern' | 'holiday' | 'override';
export type RuleStatus = 'pending' | 'unconfirmed' | 'active' | 'rejected' | 'withdrawn' | 'retired';
/** Statuses that take effect in the timeline. */
export const ACTIVE_RULE_STATUSES: readonly RuleStatus[] = ['active', 'unconfirmed'];

export interface DefaultConfig {
  parent: number;
}

export type PatternTemplate = 'alternating_weekends' | 'every_weekend' | 'week_on_week_off' | '2-2-3' | '2-2-5-5' | '3-4-4-3' | 'custom';

export interface PatternSegment {
  /** day index inside the cycle, 0-based; endDay may equal cycleDays */
  startDay: number;
  startTime: string;
  endDay: number;
  endTime: string;
  parent: number;
}

export interface PatternConfig {
  template?: PatternTemplate;
  anchorDate: string;
  cycleDays: number;
  segments: PatternSegment[];
  /** custom template: one parent id (or null = default parent) per cycle day */
  days?: (number | null)[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/** Body field `template` of POST /api/rules (type 'pattern') and POST /api/schedule/preview. */
export interface PatternTemplateInput {
  template: PatternTemplate;
  anchorDate: string;
  parentA: number;
  parentB: number;
  exchangeTime?: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  options?: {
    weekendStart?: string;
    weekendEnd?: string;
    midweek?: boolean;
    midweekStart?: string;
    midweekEnd?: string;
    days?: (number | null)[];
  };
}

export type HolidayDateRule =
  | { type: 'fixed'; month: number; day: number }
  /** weekday 0=Sun; n = 1..5 or -1 for last */
  | { type: 'nth_weekday'; month: number; weekday: number; n: number }
  | { type: 'easter' }
  | { type: 'range'; startMonth: number; startDay: number; endMonth: number; endDay: number }
  | { type: 'once'; startDate: string; endDate?: string | null };

export interface HolidayBoundary {
  /** days relative to the holiday date: negative = before (start), positive = after (end) */
  dayOffset: number;
  time: string;
}

export type HolidayAssignment =
  | { mode: 'fixed'; parent: number }
  | { mode: 'alternate'; evenYears: number; oddYears: number };

export interface HolidayConfig {
  rule: HolidayDateRule;
  start: HolidayBoundary;
  end: HolidayBoundary;
  assignment: HolidayAssignment;
}

export interface OverridePeriod {
  /** 'YYYY-MM-DDTHH:MM' family local time */
  start: string;
  end: string;
  parent: number;
}

export interface OverrideConfig {
  periods: OverridePeriod[];
}

interface RuleBase {
  id: number;
  family_id: number;
  name: string;
  priority: number;
  reason: string;
  status: RuleStatus;
  requested_by: number;
  requested_by_name: string;
  requested_at: string;
  decided_by: number | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  retire_requested_by: number | null;
  retire_requested_at: string | null;
  supersedes: number | null;
}

export type DefaultRule = RuleBase & { type: 'default'; config: DefaultConfig };
export type PatternRule = RuleBase & { type: 'pattern'; config: PatternConfig };
export type HolidayRule = RuleBase & { type: 'holiday'; config: HolidayConfig };
export type OverrideRule = RuleBase & { type: 'override'; config: OverrideConfig };
/** GET /api/rules -> Rule[] */
export type Rule = DefaultRule | PatternRule | HolidayRule | OverrideRule;

/** GET /api/holiday-presets -> HolidayPreset[] */
export interface HolidayPreset {
  key: string;
  name: string;
  rule: HolidayDateRule;
}

/** POST /api/rules/:id/decide and /api/call-rules/:id/decide */
export interface DecideResponse {
  ok: true;
  status: 'active' | 'rejected';
}

/** POST /api/rules/:id/retire */
export interface RetireResponse {
  ok: true;
  status: string;
  retire_pending?: true;
}

// ---------- timeline & time share ----------

export interface TimelineSource {
  type: RuleType;
  id: number | null;
  name: string;
}

export interface TimelineInterval {
  /** UTC ms */
  start: number;
  end: number;
  /** parent user id, or null when nobody is assigned */
  parent: number | null;
  src: TimelineSource;
}

export interface Transition {
  /** UTC ms when custody changes hands */
  at: number;
  from: number | null;
  to: number | null;
  src: TimelineSource;
}

export interface ShareRow {
  parent: number | null;
  name: string;
  hours: number;
  pct: number;
  overnights: number;
  nightPct: number;
}

export interface Share {
  /** keyed by parent id (as string) or 'unassigned' */
  hours: Record<string, number>;
  pct: Record<string, number>;
  overnights: Record<string, number>;
  nightPct: Record<string, number>;
  totalHours: number;
  totalNights: number;
  byParent: ShareRow[];
}

/** GET /api/timeline?start&end */
export interface TimelineResponse {
  start: string;
  end: string;
  timezone: string;
  timeline: TimelineInterval[];
  share: Share;
  transitions: Transition[];
}

/** GET /api/rules/:id/impact */
export interface ImpactResponse {
  start: string;
  end: string;
  before: Share;
  after: Share;
}

/** POST /api/schedule/preview */
export interface PreviewResponse {
  timeline: TimelineInterval[];
  share: Share;
}

// ---------- events (activities & appointments) ----------

export type EventStatus = 'proposed' | 'accepted' | 'declined' | 'cancelled';
export type EventCategory = 'activity' | 'school' | 'medical' | 'therapy' | 'social' | 'travel' | 'other';

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** weekdays 0=Sun..6=Sat (weekly) */
  byday: number[];
  until: string | null;
  /** skipped instance dates */
  exdates: string[];
}

/** One occurrence of an event (series are expanded by the server). */
export interface EventInstance {
  id: number;
  family_id: number;
  title: string;
  category: EventCategory | string;
  child_ids: number[];
  start_local: string;
  end_local: string;
  location: string;
  transport_parent: number | null;
  recurrence: Recurrence | null;
  details: string;
  cost_cents: number | null;
  status: EventStatus;
  created_by: number;
  created_at: string;
  responded_by: number | null;
  responded_at: string | null;
  response_note: string | null;
  updated_at: string | null;
  /** 'YYYY-MM-DD' of this occurrence */
  instance_date: string;
  /** UTC ms */
  start: number;
  end: number;
  /** parent who has custody when the event starts */
  custody_parent: number | null;
  /** only on GET /api/events */
  note_count?: number;
}

/** Event from an imported calendar feed (read-only). */
export interface ExternalEvent {
  id: number;
  feed_id: number;
  uid: string;
  title: string;
  start_ms: number;
  end_ms: number;
  all_day: 0 | 1;
  location: string | null;
  feed_name: string;
  provider: FeedProvider;
  owner: number;
}

/** GET /api/events?start&end */
export interface EventsResponse {
  events: EventInstance[];
  external: ExternalEvent[];
}

// ---------- expenses & payments ----------

export type ExpenseStatus = 'logged' | 'requested' | 'approved' | 'disputed' | 'reimbursed';
export type ExpenseCategory = 'medical' | 'school' | 'childcare' | 'activities' | 'clothing' | 'travel' | 'other';

export interface Expense {
  id: number;
  family_id: number;
  description: string;
  category: ExpenseCategory | string;
  amount_cents: number;
  date: string;
  child_ids: number[];
  event_id: number | null;
  paid_by: number;
  /** the OTHER parent's share in percent */
  other_share_pct: number;
  receipt_hash: string | null;
  receipt_name: string | null;
  receipt_type: string | null;
  status: ExpenseStatus;
  created_at: string;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
  /** amount the other parent owes for this expense */
  owed_cents: number;
  note_count: number;
}

export type PaymentStatus = 'sent' | 'confirmed' | 'disputed';

export interface Payment {
  id: number;
  family_id: number;
  from_user: number;
  to_user: number;
  amount_cents: number;
  date: string;
  method: string;
  note: string;
  expense_ids: number[];
  status: PaymentStatus;
  created_at: string;
  confirmed_at: string | null;
}

/** GET /api/balance (also Dashboard.balance for parents) */
export interface Balance {
  /** > 0: the co-parent owes the caller; < 0: the caller owes */
  net_cents: number;
  pending_to_me: number;
  pending_from_me: number;
  disputed_cents: number;
  /** payments sent to the caller that they have not confirmed */
  unconfirmed_payments: number;
}

// ---------- files & notes ----------

/** Upload payload used by notes (attachment) and expenses (receipt). data is base64 without a data: prefix. */
export interface FilePayload {
  name: string;
  type: string;
  data: string;
}

export type NoteTargetType = 'event' | 'expense' | 'rule' | 'call' | 'exchange' | 'payment' | 'call_rule' | 'day' | 'general';

export interface Note {
  id: number;
  family_id: number;
  target_type: NoteTargetType;
  target_id: string;
  body: string;
  author: number;
  author_name: string;
  created_at: string;
  attachment_hash: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  content_hash: string;
}

// ---------- messages ----------

export type ThreadTopic = 'general' | 'schedule' | 'expenses' | 'school' | 'medical' | 'activities' | 'other';

/** GET /api/threads -> Thread[] (with counts); GET /api/threads/:id -> { thread } (without counts) */
export interface Thread {
  id: number;
  family_id: number;
  subject: string;
  topic: ThreadTopic;
  created_by: number;
  created_at: string;
  last_at?: string | null;
  count?: number;
  unread?: number;
}

export interface MessageRead {
  /** reader's name */
  user: string;
  /** ISO time */
  at: string;
}

export interface Message {
  id: number;
  thread_id: number;
  family_id: number;
  author: number;
  author_name: string;
  body: string;
  created_at: string;
  content_hash: string;
  reads: MessageRead[];
}

/** GET /api/threads/:id (marks messages read for parents) */
export interface ThreadResponse {
  thread: Thread;
  messages: Message[];
}

export interface ToneIssue {
  id: string;
  label: string;
  tip: string;
  matches: string[];
}

/** POST /api/tone-check {text} */
export interface ToneResult {
  ok: boolean;
  issues: ToneIssue[];
  wordCount: number;
}

// ---------- calls ----------

export type CallMethod = 'phone' | 'video' | 'either';
export type CallPeriod = 'day' | 'week' | 'month';

export interface CallWindow {
  /** allowed weekdays 0=Sun..6; empty = any day */
  days: number[];
  start: string | null;
  end: string | null;
  only_other_parents_time?: boolean;
}

export interface CallRule {
  id: number;
  family_id: number;
  name: string;
  entitled_parent: number;
  entitled_name: string;
  method: CallMethod;
  count: number;
  period: CallPeriod;
  duration_min: number;
  window: CallWindow;
  reason: string;
  status: RuleStatus;
  requested_by: number;
  requested_by_name: string;
  requested_at: string;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
  retire_requested_by: number | null;
  retire_requested_at: string | null;
}

export type CallStatus = 'completed' | 'short' | 'missed_not_facilitated' | 'missed_not_called' | 'declined_by_child' | 'rescheduled' | 'cancelled';

export interface Call {
  id: number;
  family_id: number;
  rule_id: number | null;
  child_ids: number[];
  started_local: string;
  duration_min: number;
  status: CallStatus;
  method: 'phone' | 'video';
  details: string;
  logged_by: number;
  logged_by_name: string;
  created_at: string;
  confirm_result: 'agreed' | 'disputed' | null;
  confirmed_by: number | null;
  confirmed_at: string | null;
}

export interface CompliancePeriod {
  start: string;
  end: string;
  allowed: number;
  completed: number;
  short: number;
  missed_not_facilitated: number;
  missed_not_called: number;
  declined_by_child: number;
  disputed: number;
  outside_window: number;
}

export interface ComplianceTotals {
  allowed: number;
  completed: number;
  missed_not_facilitated: number;
  missed_not_called: number;
  short: number;
  disputed: number;
  outside_window: number;
}

/** GET /api/calls/compliance -> Compliance[] (one per active call rule) */
export interface Compliance {
  rule: {
    id: number;
    name: string;
    /** entitled parent's name */
    entitled: string;
    count: number;
    period: CallPeriod;
    duration_min: number;
    method: CallMethod;
    window: CallWindow;
  };
  periods: CompliancePeriod[];
  totals: ComplianceTotals;
}

// ---------- exchanges ----------

export type ExchangeKind = 'dropoff' | 'pickup' | 'no_show_other' | 'late_other';

export interface Exchange {
  id: number;
  family_id: number;
  kind: ExchangeKind;
  /** server timestamp of the check-in, UTC ms */
  at_ms: number;
  /** nearest scheduled custody transition within 8 hours, UTC ms */
  scheduled_ms: number | null;
  location: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  child_ids: number[];
  details: string;
  logged_by: number;
  logged_by_name: string;
  created_at: string;
  /** positive = late, negative = early, null = no scheduled exchange nearby */
  minutes_late: number | null;
}

/** POST /api/exchanges */
export interface ExchangeCreated {
  id: number;
  scheduled_ms: number | null;
}

// ---------- calendar feeds ----------

export type FeedProvider = 'google' | 'apple' | 'outlook' | 'other';

export interface Feed {
  id: number;
  name: string;
  provider: FeedProvider;
  visibility: 'me' | 'family';
  last_sync: string | null;
  last_error: string | null;
  user_id: number;
  /** number of imported events */
  events: number;
}

/** POST /api/feeds and /api/feeds/:id/sync */
export interface FeedSyncResult {
  id?: number;
  ok: boolean;
  count?: number;
  error?: string;
}

// ---------- dashboard ----------

export interface PendingCounts {
  rules: number;
  call_rules: number;
  events: number;
  expenses: number;
  payments: number;
  calls: number;
  /** unread messages */
  messages: number;
}

/** GET /api/dashboard */
export interface Dashboard {
  now: { parent: number | null };
  next_exchange: Transition | null;
  share_year: Share;
  share_ytd: Share;
  /** all zero for viewers */
  pending: PendingCounts;
  /** null for viewers */
  balance: Balance | null;
  /** next 14 days, max 8 */
  upcoming: EventInstance[];
  /** this week (Mon-today) */
  compliance: Compliance[];
}

// ---------- records ----------

export interface AuditEntry {
  id: number;
  family_id: number;
  seq: number;
  ts: string;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  data: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

/** GET /api/audit/verify */
export interface Verify {
  ok: boolean;
  entries: number;
  /** current chain head (fingerprint) */
  head: string;
  problems: string[];
}

/** POST /api/report-link {start?, end?} */
export interface ReportLink {
  /** path relative to the API base, e.g. '/report?rt=...&start=..&end=..' */
  url: string;
  expires_at: string;
}

// ---------- notifications ----------

export type NotificationKind =
  | 'rule_requested' | 'rule_decided' | 'rule_retire_requested' | 'rule_retire_decided'
  | 'call_rule_requested' | 'call_rule_decided'
  | 'event_proposed' | 'event_responded'
  | 'expense_requested' | 'expense_decided' | 'payment_sent' | 'payment_confirmed'
  | 'call_logged' | 'call_confirmed'
  | 'message' | 'exchange_checkin' | 'member_joined' | 'member_left' | 'exchange_reminder';

/**
 * Shared link format: 'dashboard' | 'calendar' | 'schedule' | 'activities' | 'expenses' | 'messages'
 * | 'messages/<threadId>' | 'calls' | 'exchanges' | 'records' | 'settings'. See lib/links.ts.
 */
export type NotificationLink = string;

/** GET /api/notifications?limit&before -> AppNotification[] (newest first) */
export interface AppNotification {
  id: number;
  kind: NotificationKind | string;
  title: string;
  body: string;
  link: NotificationLink;
  entity: string | null;
  entity_id: string | null;
  created_at: string;
  read_at: string | null;
}
/** Alias matching the contract name. */
export type Notification = AppNotification;

/** POST /api/notifications/read {ids?|all?} */
export interface NotificationsReadResponse {
  ok: true;
  unread: number;
}
