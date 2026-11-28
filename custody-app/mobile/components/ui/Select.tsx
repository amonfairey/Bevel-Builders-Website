import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TOUCH, useTheme } from '@/lib/theme';
import { AppText } from './AppText';
import { tapHaptic } from './Button';
import { FieldShell } from './Field';

export type OptionValue = string | number | null;
export interface Option<V extends OptionValue = OptionValue> {
  value: V;
  label: string;
  /** muted second line in the picker list */
  hint?: string;
}

export interface SelectProps<V extends OptionValue> {
  label?: string;
  value: V | undefined;
  options: readonly Option<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  disabled?: boolean;
  testID?: string;
}

/** Tap to open a bottom-sheet list of options (works on iOS, Android and web). */
export function Select<V extends OptionValue>({ label, value, options, onChange, placeholder = 'Choose…', hint, error, disabled, testID }: SelectProps<V>) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <Pressable
        onPress={() => { if (!disabled) { tapHaptic(); setOpen(true); } }}
        accessibilityRole="button"
        accessibilityLabel={`${label ? `${label}: ` : ''}${current?.label ?? placeholder}`}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        testID={testID}
        style={({ pressed }) => [styles.control, { borderColor: error ? t.colors.bad : t.colors.line, backgroundColor: t.colors.panel, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
      >
        <AppText style={{ flex: 1 }} tone={current ? 'ink' : 'muted'} numberOfLines={1}>{current?.label ?? placeholder}</AppText>
        <Ionicons name="chevron-down" size={18} color={t.colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: t.colors.overlay }]} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: t.colors.panel, paddingBottom: insets.bottom + 8 }]}>
          <View style={[styles.sheetHead, { borderBottomColor: t.colors.line }]}>
            <AppText variant="headline" style={{ flex: 1 }}>{label ?? 'Choose'}</AppText>
            <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done">
              <AppText weight="600" tone="accent">Done</AppText>
            </Pressable>
          </View>
          <FlatList
            data={options as Option<V>[]}
            keyExtractor={(o) => String(o.value)}
            style={{ maxHeight: 420 }}
            renderItem={({ item }) => {
              const sel = item.value === value;
              return (
                <Pressable
                  onPress={() => { tapHaptic(); onChange(item.value); setOpen(false); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel }}
                  style={({ pressed }) => [styles.option, { borderBottomColor: t.colors.line, backgroundColor: pressed ? t.colors.soft : 'transparent' }]}
                >
                  <View style={{ flex: 1 }}>
                    <AppText weight={sel ? '600' : '400'}>{item.label}</AppText>
                    {item.hint ? <AppText variant="footnote" tone="muted">{item.hint}</AppText> : null}
                  </View>
                  {sel ? <Ionicons name="checkmark" size={20} color={t.colors.accent} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </FieldShell>
  );
}

export interface ChipsProps<V extends string | number> {
  options: readonly Option<V>[];
  values: readonly V[];
  onChange: (values: V[]) => void;
  /** single choice when false (default true = multi-select) */
  multiple?: boolean;
  disabled?: boolean;
}

/** Row of toggle pills (children, weekdays). Multi-select by default. */
export function Chips<V extends string | number>({ options, values, onChange, multiple = true, disabled }: ChipsProps<V>) {
  const t = useTheme();
  const toggle = (v: V) => {
    if (disabled) return;
    tapHaptic();
    if (!multiple) return onChange([v]);
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = values.includes(o.value as V);
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => toggle(o.value as V)}
            accessibilityRole={multiple ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: on, disabled: !!disabled }}
            accessibilityLabel={o.label}
            hitSlop={4}
            style={({ pressed }) => [styles.chip, {
              backgroundColor: on ? t.colors.accent : t.colors.panel,
              borderColor: on ? t.colors.accent : t.colors.line,
              opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
            }]}
          >
            {on ? <Ionicons name="checkmark" size={15} color={t.colors.accentInk} style={{ marginRight: 4 }} /> : null}
            <AppText variant="subhead" weight="500" style={{ color: on ? t.colors.accentInk : t.colors.ink }}>{o.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Labelled Chips (e.g. "Children", "Weekly on"). */
export function MultiSelect<V extends string | number>({ label, hint, error, ...rest }: ChipsProps<V> & { label?: string; hint?: string; error?: string | null }) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      <Chips {...rest} />
    </FieldShell>
  );
}

/** Segmented control (iOS style) for 2-4 mutually exclusive views. */
export function Segmented<V extends string>({ options, value, onChange }: { options: readonly Option<V>[]; value: V; onChange: (v: V) => void }) {
  const t = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: t.colors.soft }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => { tapHaptic(); onChange(o.value); }} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[styles.segmentItem, on && { backgroundColor: t.colors.panel, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }]}>
            <AppText variant="subhead" weight={on ? '600' : '500'} numberOfLines={1}>{o.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  control: { minHeight: TOUCH, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  backdrop: StyleSheet.absoluteFill,
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  option: { minHeight: TOUCH + 4, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  segment: { flexDirection: 'row', borderRadius: 9, padding: 2, marginBottom: 16 },
  segmentItem: { flex: 1, minHeight: 32, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
