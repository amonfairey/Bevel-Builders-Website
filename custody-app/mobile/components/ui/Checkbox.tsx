import { Pressable, StyleSheet, Switch, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TOUCH, useTheme } from '@/lib/theme';
import { AppText } from './AppText';
import { tapHaptic } from './Button';

export interface CheckboxProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
  disabled?: boolean;
  testID?: string;
}

/** Tappable row with a check circle and label (form options like "Ask for reimbursement now"). */
export function Checkbox({ label, value, onChange, hint, disabled, testID }: CheckboxProps) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => { if (!disabled) { tapHaptic(); onChange(!value); } }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.row, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={value ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={value ? t.colors.accent : t.colors.muted} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <AppText>{label}</AppText>
        {hint ? <AppText variant="footnote" tone="muted">{hint}</AppText> : null}
      </View>
    </Pressable>
  );
}

/** Label + iOS switch (settings-style on/off). */
export function Toggle({ label, value, onChange, hint, disabled }: CheckboxProps) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, marginRight: 10 }}>
        <AppText>{label}</AppText>
        {hint ? <AppText variant="footnote" tone="muted">{hint}</AppText> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: t.colors.accent, false: t.colors.line }} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
});
