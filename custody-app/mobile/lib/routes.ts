// Pure route mapping (no React Native imports, so it is unit-testable under Node).
// Import from '@/lib/links' in app code; it re-exports everything here.

/**
 * Notification link (shared format with the web portal and server) -> app route.
 *   dashboard -> '/'            calendar -> '/calendar'     schedule -> '/schedule'
 *   activities -> '/activities' expenses -> '/money'        messages -> '/messages'
 *   messages/<id> -> '/thread/<id>'   calls -> '/calls'     exchanges -> '/exchanges'
 *   records -> '/records'       settings -> '/settings'
 * Unknown or empty links go to the notifications inbox.
 */
const LINK_ROUTES: Record<string, string> = {
  dashboard: '/',
  calendar: '/calendar',
  schedule: '/schedule',
  activities: '/activities',
  expenses: '/money',
  messages: '/messages',
  calls: '/calls',
  exchanges: '/exchanges',
  records: '/records',
  settings: '/settings',
};

/** Routes that are tab roots: navigate (switch tab) instead of pushing a new screen. */
const TAB_ROUTES = new Set(['/', '/calendar', '/messages', '/money', '/more']);

export function linkToRoute(link: string | null | undefined): string {
  const l = String(link ?? '').trim().replace(/^\/+|\/+$/g, '');
  const thread = /^messages\/(\d+)$/.exec(l);
  if (thread) return `/thread/${thread[1]}`;
  return LINK_ROUTES[l] ?? '/notifications';
}

export function isTabRoute(route: string): boolean {
  return TAB_ROUTES.has(route);
}

/**
 * Typed builders for every app route that takes params, so screens never hand-assemble
 * query strings. Use with router.push(routes.thread(5)) or <Link href={routes.day(date)}>.
 */
export const routes = {
  home: '/' as const,
  calendar: '/calendar' as const,
  messages: '/messages' as const,
  money: '/money' as const,
  more: '/more' as const,
  notifications: '/notifications' as const,
  day: (date: string) => `/day/${date}`,
  schedule: '/schedule' as const,
  rule: (id: number | string) => `/schedule/${id}`,
  scheduleChange: (date?: string) => (date ? `/schedule/change?date=${encodeURIComponent(date)}` : '/schedule/change'),
  schedulePattern: '/schedule/pattern' as const,
  scheduleHoliday: '/schedule/holiday' as const,
  schedulePrimary: '/schedule/primary' as const,
  thread: (id: number | string) => `/thread/${id}`,
  newThread: '/thread/new' as const,
  calls: '/calls' as const,
  logCall: '/calls/log' as const,
  callRule: '/calls/rule' as const,
  expense: (id: number | string) => `/expense/${id}`,
  newExpense: (pre: { eventId?: number | string; description?: string; amount?: number | string } = {}) => {
    const q = Object.entries({ eventId: pre.eventId, description: pre.description, amount: pre.amount })
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return q ? `/expense/new?${q}` : '/expense/new';
  },
  newPayment: '/payment/new' as const,
  activities: '/activities' as const,
  activity: (id: number | string) => `/activities/${id}`,
  editActivity: (id?: number | string) => (id != null ? `/activities/edit?id=${encodeURIComponent(String(id))}` : '/activities/edit'),
  exchanges: '/exchanges' as const,
  checkIn: '/exchanges/check-in' as const,
  records: '/records' as const,
  sync: '/sync' as const,
  settings: '/settings' as const,
  child: (id: number | string) => `/settings/child/${id}`,
  account: '/settings/account' as const,
  signIn: '/sign-in' as const,
  signUp: '/sign-up' as const,
  setup: '/setup' as const,
};
