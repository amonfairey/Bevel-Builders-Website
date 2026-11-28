import { useState } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { errorMessage, fetchDataUri } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { acceptedType, fileNameFor, sniffUploadType, type UploadType } from '@/lib/files';
import type { FilePayload } from '@/lib/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { useToast } from './Toast';

/**
 * Link to a stored file (/api/files/<hash>): note attachments and expense receipts.
 * Images open in an in-app viewer (fetched with the bearer token). On web, PDFs open in a
 * new tab; on iPhone, PDFs are listed and can be opened from the web portal.
 */
export function AttachmentLink({ hash, name, type, label }: { hash: string; name?: string | null; type?: string | null; label?: string }) {
  const t = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isImage = !type || type.startsWith('image/');

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const f = await fetchDataUri(`/api/files/${hash}`);
      if (f.type.startsWith('image/')) setUri(f.uri);
      else if (Platform.OS === 'web') {
        const blob = await (await fetch(f.uri)).blob();
        window.open(URL.createObjectURL(blob), '_blank', 'noopener');
      } else toast.show('PDF attachments open in the web portal (Records or the item there).');
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable onPress={open} accessibilityRole="link" hitSlop={6} style={styles.link}>
        <Ionicons name={isImage ? 'image-outline' : 'document-attach-outline'} size={16} color={t.colors.accent} />
        <AppText variant="subhead" tone="accent" style={{ marginLeft: 4 }} numberOfLines={1}>{busy ? 'Opening…' : label ?? `Attachment: ${name || 'file'}`}</AppText>
      </Pressable>
      <Modal visible={!!uri} animationType="fade" transparent onRequestClose={() => setUri(null)}>
        <View style={[styles.viewer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.viewerHead}>
            <AppText style={{ color: '#fff', flex: 1 }} numberOfLines={1}>{name || 'Attachment'}</AppText>
            <Pressable onPress={() => setUri(null)} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
              <AppText weight="600" style={{ color: '#fff' }}>Done</AppText>
            </Pressable>
          </View>
          {uri ? <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel={name || 'Attachment'} /> : null}
        </View>
      </Modal>
    </>
  );
}

const MAX_UPLOAD = 8 * 1024 * 1024;

/**
 * Web preview only: re-encode an image the browser can decode (BMP, AVIF, SVG, oversized PNG...)
 * as JPEG through a canvas. Returns the base64 JPEG, or null when that isn't possible.
 */
async function reencodeJpegOnWeb(b64: string, mime: string | undefined): Promise<string | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  try {
    const img = new window.Image();
    img.src = `data:${mime || 'image/png'};base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) return null;
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const url = canvas.toDataURL('image/jpeg', 0.8);
    return url.startsWith('data:image/jpeg') ? url.slice(url.indexOf(',') + 1) : null;
  } catch {
    return null;
  }
}

/**
 * Pick or take a photo and return it as an upload payload ({ name, type, data: base64 })
 * for /api/notes `attachment` or /api/expenses `receipt`. Returns null when cancelled.
 *
 * The type and extension come from the bytes actually sent: on iPhone the picker's base64 is
 * always a JPEG re-encode (even for HEIC/PNG originals), on Android it is the compressed
 * export (PNG or JPEG), and on web it is the original file. Anything the server doesn't
 * accept (image/png|jpeg|gif|webp|heic) is re-encoded as JPEG in the web preview, or refused.
 */
export async function pickImagePayload(source: 'library' | 'camera'): Promise<FilePayload | null> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.6, exif: false };
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off. Turn it on in Settings > CoParent Hub.');
  }
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  if (!a.base64) throw new Error('Could not read that photo');
  let data = a.base64;
  // Trust the bytes first; fall back to the picker's MIME type only if they are inconclusive.
  let type: UploadType | null = sniffUploadType(data) ?? acceptedType(a.mimeType);
  if (type === 'application/pdf') type = null; // this picker is for photos
  if (!type || data.length * 0.75 > MAX_UPLOAD) {
    const jpeg = await reencodeJpegOnWeb(data, a.mimeType);
    if (jpeg && (!type || jpeg.length < data.length)) { data = jpeg; type = 'image/jpeg'; }
  }
  if (!type) throw new Error('That image type isn\'t supported. Choose a JPEG, PNG, GIF, WebP or HEIC photo.');
  if (data.length * 0.75 > MAX_UPLOAD) throw new Error('Photo must be under 8 MB');
  return { name: fileNameFor(a.fileName, type, `photo-${Date.now()}`), type, data };
}

/** "Add photo" / "Take photo" buttons plus the chosen file's name with a remove link. */
export function PhotoPicker({ value, onChange }: { value: FilePayload | null; onChange: (f: FilePayload | null) => void }) {
  const toast = useToast();
  const pick = async (src: 'library' | 'camera') => {
    try {
      const f = await pickImagePayload(src);
      if (f) onChange(f);
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'bad' });
    }
  };
  if (value) {
    return (
      <View style={styles.chosen}>
        <Ionicons name="image" size={18} color="#2e7d55" />
        <AppText variant="subhead" style={{ flex: 1, marginLeft: 6 }} numberOfLines={1}>{value.name}</AppText>
        <Button title="Remove" variant="link" size="sm" onPress={() => onChange(null)} />
      </View>
    );
  }
  return (
    <View style={styles.pickRow}>
      <Button title="Add photo" icon="images-outline" size="sm" onPress={() => pick('library')} />
      {Platform.OS !== 'web' ? <Button title="Take photo" icon="camera-outline" size="sm" onPress={() => pick('camera')} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', marginTop: 4, minHeight: 28 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', paddingHorizontal: 12 },
  viewerHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  pickRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chosen: { flexDirection: 'row', alignItems: 'center', minHeight: 36 },
});
