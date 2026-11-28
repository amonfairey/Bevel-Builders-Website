import { forwardRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Platform, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { TOUCH, useTheme } from '@/lib/theme';
import { AppText } from './AppText';

/**
 * Web preview only: drop the browser's own focus ring (dark outline) from a text input, so the
 * accent border shows focus as on iPhone. `outlineStyle: 'none'` matters for <textarea>
 * (multi-line inputs), where Chrome keeps an `outline-style: auto` ring at width 0.
 * Typed loosely because React Native's outlineStyle type has no 'none'.
 */
export const WEB_NO_OUTLINE: TextStyle | null = Platform.OS === 'web' ? ({ outlineWidth: 0, outlineStyle: 'none' } as unknown as TextStyle) : null;

/** Label + control + hint + error wrapper used by every form control. */
export function FieldShell({ label, hint, error, children, style, labelRight }: { label?: string; hint?: string; error?: string | null; children: ReactNode; style?: StyleProp<ViewStyle>; labelRight?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[{ marginBottom: t.spacing.lg }, style]}>
      {label || labelRight ? (
        <View style={styles.labelRow}>
          {label ? <AppText variant="footnote" tone="muted" weight="500">{label}</AppText> : <View />}
          {labelRight}
        </View>
      ) : null}
      {children}
      {error ? <AppText variant="footnote" tone="bad" style={{ marginTop: 4 }} accessibilityLiveRegion="polite">{error}</AppText>
        : hint ? <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>{hint}</AppText> : null}
    </View>
  );
}

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
  inputStyle?: TextInputProps['style'];
}

export type TextInputRef = ComponentRef<typeof TextInput>;

/** Labelled text input. Pass TextInput props (value, onChangeText, keyboardType, autoComplete...). */
export const Field = forwardRef<TextInputRef, FieldProps>(function Field({ label, hint, error, style, inputStyle, multiline, onFocus, onBlur, ...rest }, ref) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <FieldShell label={label} hint={hint} error={error} style={style}>
      <TextInput
        ref={ref}
        placeholderTextColor={t.colors.muted}
        multiline={multiline}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[
          styles.input,
          {
            color: t.colors.ink, backgroundColor: t.colors.panel,
            borderColor: error ? t.colors.bad : focused ? t.colors.accent : t.colors.line,
            fontSize: t.fontSize.body,
          },
          multiline ? styles.multi : null,
          WEB_NO_OUTLINE,
          inputStyle,
        ]}
        {...rest}
      />
    </FieldShell>
  );
});

/** Multi-line Field (min 100 pt tall). */
export const TextArea = forwardRef<TextInputRef, FieldProps>(function TextArea(props, ref) {
  return <Field ref={ref} multiline textAlignVertical="top" {...props} />;
});

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  input: { minHeight: TOUCH, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  multi: { minHeight: 100, paddingTop: 10 },
});
