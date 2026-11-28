import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { AppText } from './AppText';
import { Button, type ButtonVariant } from './Button';

/**
 * Dialog system built on RN <Modal> (NOT Alert.alert: react-native-web's Alert is a no-op,
 * so this works in the web preview too).
 *
 *   const dialog = useDialog();
 *   const r = await dialog.confirm({ title: 'Approve "Swap weekend"?', okLabel: 'Approve', withNote: true });
 *   if (r) await api.post(`/api/rules/${id}/decide`, { decision: 'approve', note: r.note });
 *
 *   await dialog.alert('Saved', 'Your co-parent will be asked to approve.');
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** red OK button */
  destructive?: boolean;
  /** show a note box; its text is returned as `note` (decision notes are saved to the record) */
  withNote?: boolean;
  /** OK is blocked until a note is written */
  noteRequired?: boolean;
  notePlaceholder?: string;
}

export interface DialogAction<V> {
  label: string;
  value: V;
  variant?: ButtonVariant;
}

export interface ShowOptions<V> {
  title: string;
  message?: string;
  /** custom content under the message */
  content?: ReactNode;
  /** buttons, rendered in order (first = most prominent); tapping one resolves with its value */
  actions: DialogAction<V>[];
  /** value when dismissed (backdrop / Android back) */
  dismissValue: V;
}

export interface DialogApi {
  confirm: (o: ConfirmOptions) => Promise<{ note: string } | null>;
  alert: (title: string, message?: string) => Promise<void>;
  show: <V>(o: ShowOptions<V>) => Promise<V>;
}

const DialogContext = createContext<DialogApi | null>(null);

type NewEntry =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: { note: string } | null) => void }
  | { kind: 'show'; opts: ShowOptions<unknown>; resolve: (v: unknown) => void };
type Entry = NewEntry & { id: number };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Entry[]>([]);
  const nextId = useRef(1);
  const push = useCallback((e: NewEntry) => { const id = nextId.current++; setQueue((q) => [...q, { ...e, id }]); }, []);
  const pop = useCallback(() => setQueue((q) => q.slice(1)), []);

  const api = useMemo<DialogApi>(() => ({
    confirm: (opts) => new Promise((resolve) => push({ kind: 'confirm', opts, resolve })),
    alert: (title, message) => new Promise<void>((resolve) => push({
      kind: 'show', opts: { title, message, actions: [{ label: 'OK', value: undefined, variant: 'primary' }], dismissValue: undefined }, resolve: () => resolve(),
    })),
    show: <V,>(opts: ShowOptions<V>) => new Promise<V>((resolve) => push({ kind: 'show', opts: opts as ShowOptions<unknown>, resolve: resolve as (v: unknown) => void })),
  }), [push]);

  const current = queue[0];
  return (
    <DialogContext.Provider value={api}>
      {children}
      {current ? <DialogView key={current.id} entry={current} done={pop} /> : null}
    </DialogContext.Provider>
  );
}

function DialogView({ entry, done }: { entry: Entry; done: () => void }) {
  const t = useTheme();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const settled = useRef(false);
  const finish = (fn: () => void) => { if (settled.current) return; settled.current = true; fn(); done(); };

  const dismiss = () => finish(() => (entry.kind === 'confirm' ? entry.resolve(null) : entry.resolve(entry.opts.dismissValue)));

  let body: ReactNode;
  let buttons: ReactNode;
  if (entry.kind === 'confirm') {
    const o = entry.opts;
    body = o.withNote ? (
      <View style={{ marginTop: 12 }}>
        <TextInput
          value={note}
          onChangeText={(v) => { setNote(v); if (noteError) setNoteError(null); }}
          placeholder={o.notePlaceholder ?? (o.noteRequired ? 'Required' : 'Optional note (saved to the record)')}
          placeholderTextColor={t.colors.muted}
          multiline
          autoFocus={o.noteRequired}
          accessibilityLabel="Note"
          style={[styles.note, { color: t.colors.ink, borderColor: noteError ? t.colors.bad : t.colors.line, backgroundColor: t.colors.bg }]}
        />
        {noteError ? <AppText variant="footnote" tone="bad" style={{ marginTop: 4 }}>{noteError}</AppText> : null}
      </View>
    ) : null;
    buttons = (
      <>
        <Button
          title={o.okLabel ?? 'Confirm'}
          variant={o.destructive ? 'danger' : 'primary'}
          block
          onPress={() => {
            if (o.noteRequired && !note.trim()) { setNoteError('Add a note first'); return; }
            finish(() => entry.resolve({ note: note.trim() }));
          }}
          testID="dialog-ok"
        />
        <Button title={o.cancelLabel ?? 'Cancel'} block onPress={dismiss} testID="dialog-cancel" />
      </>
    );
  } else {
    body = entry.opts.content ?? null;
    buttons = entry.opts.actions.map((a, i) => (
      <Button key={i} title={a.label} variant={a.variant ?? (i === 0 ? 'primary' : 'default')} block onPress={() => finish(() => entry.resolve(a.value))} testID={`dialog-action-${i}`} />
    ));
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }]} onPress={dismiss} accessibilityLabel="Dismiss" />
        <View style={[styles.box, { backgroundColor: t.colors.panel }]} accessibilityViewIsModal accessibilityRole="alert">
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
            <AppText variant="headline" accessibilityRole="header">{entry.opts.title}</AppText>
            {entry.opts.message ? <AppText tone="muted" style={{ marginTop: 6 }}>{entry.opts.message}</AppText> : null}
            {body}
          </ScrollView>
          <View style={styles.buttons}>{buttons}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function useDialog(): DialogApi {
  const v = useContext(DialogContext);
  if (!v) throw new Error('useDialog must be used inside <DialogProvider>');
  return v;
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  box: { width: '100%', maxWidth: 420, borderRadius: 16, padding: 20 },
  note: { minHeight: 90, borderWidth: 1, borderRadius: 10, padding: 10, textAlignVertical: 'top', fontSize: 16 },
  buttons: { marginTop: 18, gap: 8 },
});
