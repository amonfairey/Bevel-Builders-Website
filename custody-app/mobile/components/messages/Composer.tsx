import { forwardRef, useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, tapHaptic, type TextInputRef } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/** True while the software keyboard is up (iOS: from keyboardWillShow, so padding changes with the animation). */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, () => setVisible(true));
    const b = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return visible;
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => Promise<unknown>;
  sending: boolean;
}

/**
 * Message box pinned to the bottom of a conversation: growing text input, round Send button,
 * and the permanence notice. Pads the home-indicator area only while the keyboard is down.
 */
export const Composer = forwardRef<TextInputRef, ComposerProps>(function Composer({ value, onChange, onSend, sending }, ref) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const [focused, setFocused] = useState(false);
  const canSend = !!value.trim() && !sending;
  return (
    <View style={[styles.bar, { backgroundColor: t.colors.panel, borderTopColor: t.colors.line, paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 8) }]}>
      <View style={styles.row}>
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChange}
          placeholder="Brief, informative, friendly, firm."
          placeholderTextColor={t.colors.muted}
          multiline
          // web preview: start as one line like the native input (textarea defaults to 2 rows)
          rows={Platform.OS === 'web' ? 1 : undefined}
          maxLength={8000}
          accessibilityLabel="Reply"
          testID="composer-input"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            styles.input,
            { color: t.colors.ink, backgroundColor: t.colors.bg, borderColor: focused ? t.colors.accent : t.colors.line, fontSize: t.fontSize.body },
            Platform.OS === 'web' ? styles.webNoOutline : null,
          ]}
        />
        <Pressable
          onPress={() => { if (canSend) { tapHaptic(); void onSend(); } }}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          testID="composer-send"
          hitSlop={6}
          style={({ pressed }) => [styles.send, { backgroundColor: canSend || sending ? t.colors.accent : t.colors.line, opacity: pressed ? 0.7 : 1 }]}
        >
          {sending ? <ActivityIndicator size="small" color={t.colors.accentInk} /> : <Ionicons name="arrow-up" size={22} color={t.colors.accentInk} />}
        </Pressable>
      </View>
      <AppText variant="caption" tone="muted" style={styles.notice} testID="composer-notice">
        Messages are permanent: they can't be edited or deleted, and read times are recorded. Each message gets a tone check before it's sent.
      </AppText>
    </View>
  );
});

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 140, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  notice: { marginTop: 6, marginHorizontal: 4 },
  webNoOutline: { outlineWidth: 0 },
});
