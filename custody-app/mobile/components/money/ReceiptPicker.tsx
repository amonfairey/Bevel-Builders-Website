import { Image, Linking, Platform, StyleSheet, View } from 'react-native';
import { AppText, Button, FieldShell, pickImagePayload, useDialog } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import type { FilePayload } from '@/lib/types';

/**
 * Receipt photo for a new expense: "Take photo" (camera, native only) or "Choose photo"
 * (photo library; a file chooser in the web preview), via the shared pickImagePayload
 * (JPEG, PNG, GIF, WebP or HEIC as picked; max 8 MB). Shows a thumbnail of the chosen photo with Replace / Remove.
 * A denied camera permission explains how to turn it on and offers to open Settings.
 */
export function ReceiptPicker({ value, onChange, disabled }: { value: FilePayload | null; onChange: (f: FilePayload | null) => void; disabled?: boolean }) {
  const t = useTheme();
  const dialog = useDialog();

  const pick = async (src: 'library' | 'camera') => {
    try {
      const f = await pickImagePayload(src);
      if (f) onChange(f);
    } catch (e) {
      const msg = errorMessage(e);
      const denied = /access is off|permission/i.test(msg);
      if (denied && Platform.OS !== 'web') {
        const open = await dialog.show<boolean>({
          title: src === 'camera' ? 'Camera access is off' : 'Photo access is off',
          message: `To attach a receipt, allow ${src === 'camera' ? 'camera' : 'photo'} access for CoParent Hub in Settings. You can also save the expense now and add a note with the receipt later.`,
          actions: [{ label: 'Open Settings', value: true, variant: 'primary' }, { label: 'Not now', value: false }],
          dismissValue: false,
        });
        if (open) Linking.openSettings().catch(() => undefined);
      } else {
        await dialog.alert("Couldn't add the photo", msg);
      }
    }
  };

  const buttons = (
    <View style={styles.row}>
      {Platform.OS !== 'web' ? <Button title={value ? 'Retake' : 'Take photo'} icon="camera-outline" size="sm" onPress={() => pick('camera')} disabled={disabled} testID="receipt-camera" /> : null}
      <Button title={value ? 'Replace' : 'Choose photo'} icon="images-outline" size="sm" onPress={() => pick('library')} disabled={disabled} testID="receipt-library" />
      {value ? <Button title="Remove" variant="danger" size="sm" onPress={() => onChange(null)} disabled={disabled} testID="receipt-remove" /> : null}
    </View>
  );

  return (
    <FieldShell label="Receipt (optional)" hint="The photo is fingerprinted (SHA-256) so it can be shown to be unchanged. Max 8 MB.">
      {value ? (
        <View style={[styles.chosen, { borderColor: t.colors.line, backgroundColor: t.colors.panel }]} testID="receipt-chosen">
          <Image source={{ uri: `data:${value.type};base64,${value.data}` }} style={[styles.thumb, { backgroundColor: t.colors.soft }]} resizeMode="cover" accessibilityLabel="Receipt photo" testID="receipt-thumb" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <AppText variant="subhead" numberOfLines={2}>{value.name}</AppText>
            <AppText variant="footnote" tone="muted">{`${Math.max(1, Math.round((value.data.length * 0.75) / 1024))} KB`}</AppText>
          </View>
        </View>
      ) : null}
      {buttons}
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chosen: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 8, marginBottom: 8 },
  thumb: { width: 64, height: 64, borderRadius: 6 },
});
