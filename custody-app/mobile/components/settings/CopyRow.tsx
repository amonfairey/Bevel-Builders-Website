import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, ButtonRow, useToast } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { BREAK_ANYWHERE, copyText, MONO, shareText } from './share';

/**
 * A label, a selectable monospace value (code, URL, fingerprint) and Copy / Share buttons.
 * `shareMessage` turns on Share (iOS share sheet); `children` adds more buttons to the row.
 */
export function CopyRow({ label, value, hint, shareMessage, shareTitle, big, children, testID }: {
  label?: string;
  value: string;
  hint?: string;
  shareMessage?: string;
  shareTitle?: string;
  /** larger text for short codes */
  big?: boolean;
  children?: ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  const toast = useToast();
  return (
    <View style={{ marginBottom: t.spacing.lg }} testID={testID}>
      {label ? <AppText variant="footnote" tone="muted" weight="500" style={{ marginBottom: 4 }}>{label}</AppText> : null}
      <View style={[styles.box, { backgroundColor: t.colors.soft, borderColor: t.colors.line }]}>
        <AppText
          selectable
          variant={big ? 'title3' : 'footnote'}
          style={[{ fontFamily: MONO, letterSpacing: big ? 1.5 : 0 }, BREAK_ANYWHERE]}
          testID={testID ? `${testID}-value` : undefined}
        >
          {value}
        </AppText>
      </View>
      {hint ? <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>{hint}</AppText> : null}
      <ButtonRow style={{ marginTop: 8 }}>
        <Button title="Copy" icon="copy-outline" size="sm" onPress={() => copyText(value, toast)} testID={testID ? `${testID}-copy` : undefined} />
        {shareMessage ? <Button title="Share" icon="share-outline" size="sm" onPress={() => shareText(shareMessage, toast, shareTitle)} testID={testID ? `${testID}-share` : undefined} /> : null}
        {children}
      </ButtonRow>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
});
