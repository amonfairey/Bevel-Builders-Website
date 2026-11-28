import { Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fmtClock, fmtDate, fmtStamp } from '@/lib/format';
import { TOUCH, useTheme } from '@/lib/theme';
import { AppText } from './AppText';
import { FieldShell } from './Field';
import { dateToValue, valueToDate, type DateTimeFieldProps, type PickerMode } from './dateValue';

export type { DateTimeFieldProps };

/**
 * Date / time pickers whose values are wall-clock strings in the family time zone:
 *   DateField 'YYYY-MM-DD', TimeField 'HH:MM', DateTimeField 'YYYY-MM-DDTHH:MM'.
 * '' means "not set" (only possible when `optional`).
 * iOS: native compact picker. Android: native dialogs. Web: DateTimeFields.web.tsx (<input>).
 */

function display(mode: PickerMode, value: string): string {
  if (!value) return 'Not set';
  return mode === 'date' ? fmtDate(value) : mode === 'time' ? fmtClock(value) : fmtStamp(value);
}

function PickerField({ mode, label, value, onChange, hint, error, optional, min, max, disabled, testID }: DateTimeFieldProps & { mode: PickerMode }) {
  const t = useTheme();
  const date = valueToDate(mode, value);
  const minDate = min ? valueToDate('date', min) : undefined;
  const maxDate = max ? valueToDate('date', max) : undefined;

  const openAndroid = () => {
    const pick = (m: 'date' | 'time', base: Date, then: (d: Date) => void) =>
      DateTimePickerAndroid.open({
        value: base, mode: m, is24Hour: false, minimumDate: m === 'date' ? minDate : undefined, maximumDate: m === 'date' ? maxDate : undefined,
        onChange: (e: DateTimePickerEvent, d?: Date) => { if (e.type === 'set' && d) then(d); },
      });
    if (mode === 'datetime') pick('date', date, (d) => pick('time', d, (d2) => onChange(dateToValue('datetime', d2))));
    else pick(mode, date, (d) => onChange(dateToValue(mode, d)));
  };

  const clear = optional && value ? (
    <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${label ?? 'value'}`}>
      <AppText variant="footnote" tone="accent">Clear</AppText>
    </Pressable>
  ) : null;

  if (Platform.OS === 'ios') {
    return (
      <FieldShell label={label} hint={hint} error={error} labelRight={clear}>
        {value ? (
          <View style={styles.iosRow} testID={testID}>
            <DateTimePicker
              value={date}
              mode={mode}
              display="compact"
              onChange={(_e: DateTimePickerEvent, d?: Date) => { if (d) onChange(dateToValue(mode, d)); }}
              minimumDate={minDate}
              maximumDate={maxDate}
              disabled={disabled}
              accentColor={t.colors.accent}
              themeVariant={t.dark ? 'dark' : 'light'}
              style={{ alignSelf: 'flex-start' }}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => { if (!disabled) onChange(dateToValue(mode, new Date())); }}
            accessibilityRole="button"
            style={[styles.control, { borderColor: t.colors.line, backgroundColor: t.colors.panel }]}
            testID={testID}
          >
            <AppText tone="muted" style={{ flex: 1 }}>Not set (tap to choose)</AppText>
            <Ionicons name={mode === 'time' ? 'time-outline' : 'calendar-outline'} size={18} color={t.colors.muted} />
          </Pressable>
        )}
      </FieldShell>
    );
  }

  return (
    <FieldShell label={label} hint={hint} error={error} labelRight={clear}>
      <Pressable
        onPress={() => { if (!disabled) openAndroid(); }}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? ''} ${display(mode, value)}`}
        style={({ pressed }) => [styles.control, { borderColor: error ? t.colors.bad : t.colors.line, backgroundColor: t.colors.panel, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
        testID={testID}
      >
        <AppText style={{ flex: 1 }} tone={value ? 'ink' : 'muted'}>{display(mode, value)}</AppText>
        <Ionicons name={mode === 'time' ? 'time-outline' : 'calendar-outline'} size={18} color={t.colors.muted} />
      </Pressable>
    </FieldShell>
  );
}

/** Date picker; value 'YYYY-MM-DD'. */
export function DateField(props: DateTimeFieldProps) {
  return <PickerField mode="date" {...props} />;
}

/** Time picker; value 'HH:MM' (24 h). */
export function TimeField(props: DateTimeFieldProps) {
  return <PickerField mode="time" {...props} />;
}

/** Date + time picker; value 'YYYY-MM-DDTHH:MM'. */
export function DateTimeField(props: DateTimeFieldProps) {
  return <PickerField mode="datetime" {...props} />;
}

const styles = StyleSheet.create({
  control: { minHeight: TOUCH, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  iosRow: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center' },
});
