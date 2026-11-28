import { router, type Href } from 'expo-router';
import { isTabRoute } from '@/lib/links';

/** Open an app route: switch tab for tab roots, push a screen otherwise. */
export function go(route: string): void {
  if (isTabRoute(route)) router.navigate(route as Href);
  else router.push(route as Href);
}

/** 'in 5 min' / 'in 3 h' / 'in 1 day' / 'in 4 days' until instant `ms`. */
export function untilText(ms: number, now: number = Date.now()): string {
  const min = Math.round((ms - now) / 60000);
  if (min <= 0) return 'now';
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `in ${h} h`;
  const d = Math.round(h / 24);
  return `in ${plural(d, 'day')}`;
}

/** '1 item' / '3 items' */
export const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`;
