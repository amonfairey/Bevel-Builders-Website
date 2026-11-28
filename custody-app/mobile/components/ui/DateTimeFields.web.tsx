import { createElement, useState, type ChangeEvent } from 'react';
import { Pressable, View } from 'react-native';
import { TOUCH, useTheme } from '@/lib/theme';
import { AppText } from './AppText';
import { FieldShell } from './Field';
import type { DateTimeFieldProps } from './dateValue';

/**
 * Web preview implementation: renders real <input type="date|time|datetime-local"> elements
 * through react-dom, so the web build is fully testable (Playwright .fill()).
 * Values use the same formats as native: 'YYYY-MM-DD', 'HH:MM', 'YYYY-MM-DDTHH:MM'.
 */
type HtmlType = 'date' | 'time' | 'datetime-local';

function WebPicker({ type, label, value, onChange, hint, error, optional, min, max, disabled, testID }: DateTimeFieldProps & { type: HtmlType }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const clear = optional && value ? (
    <Pressable onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel={`Clear ${label ?? 'value'}`}>
      <AppText variant="footnote" tone="accent">Clear</AppText>
    </Pressable>
  ) : null;
  const input = createElement('input', {
    type,
    value: value || '',
    min: type === 'datetime-local' && min ? `${min}T00:00` : min,
    max: type === 'datetime-local' && max ? `${max}T23:59` : max,
    disabled,
    'aria-label': label,
    'data-testid': testID,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (v || optional) onChange(type === 'datetime-local' ? v.slice(0, 16) : type === 'time' ? v.slice(0, 5) : v);
    },
    style: {
      boxSizing: 'border-box', width: '100%', minHeight: TOUCH, padding: '8px 12px', borderRadius: 10,
      border: `1px solid ${error ? t.colors.bad : focused ? t.colors.accent : t.colors.line}`,
      background: t.colors.panel, color: t.colors.ink, font: 'inherit', fontSize: t.fontSize.body,
      colorScheme: t.dark ? 'dark' : 'light',
    },
  });
  return (
    <FieldShell label={label} hint={hint} error={error} labelRight={clear}>
      <View>{input}</View>
    </FieldShell>
  );
}

export function DateField(props: DateTimeFieldProps) {
  return <WebPicker type="date" {...props} />;
}

export function TimeField(props: DateTimeFieldProps) {
  return <WebPicker type="time" {...props} />;
}

export function DateTimeField(props: DateTimeFieldProps) {
  return <WebPicker type="datetime-local" {...props} />;
}

export type { DateTimeFieldProps };
