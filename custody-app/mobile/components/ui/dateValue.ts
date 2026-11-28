import { pad } from '@/lib/format';

export type PickerMode = 'date' | 'time' | 'datetime';

/** Props shared by DateField / TimeField / DateTimeField (native and web). */
export interface DateTimeFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  /** allow clearing the value ('' = not set) */
  optional?: boolean;
  /** 'YYYY-MM-DD' bounds (date and datetime modes) */
  min?: string;
  max?: string;
  disabled?: boolean;
  testID?: string;
}


/**
 * Pickers work with device-local Date objects; our values are wall-clock strings in the
 * family zone. We map the string's components 1:1 onto a device-local Date (and back), so
 * the zone never shifts what the user picked.
 */
export function valueToDate(mode: PickerMode, value: string): Date {
  const now = new Date();
  if (mode === 'time') {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    return m ? new Date(2000, 0, 1, +m[1], +m[2]) : new Date(2000, 0, 1, now.getHours(), 0);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return mode === 'date' ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12) : now;
  // dates use noon so a device-zone DST change can never move them to another day
  return mode === 'date' ? new Date(+m[1], +m[2] - 1, +m[3], 12) : new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
}

export function dateToValue(mode: PickerMode, d: Date): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return mode === 'date' ? date : mode === 'time' ? time : `${date}T${time}`;
}
