import { Platform, Share, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/** Monospace font for codes, URLs and hashes. */
export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' });

/**
 * Let long unbroken strings (URLs, hashes) wrap anywhere. iOS already breaks them by
 * character; the web preview needs CSS word-break or they overflow the screen.
 */
export const BREAK_ANYWHERE: TextStyle | null = Platform.OS === 'web' ? ({ wordBreak: 'break-all' } as unknown as TextStyle) : null;

type Toast ={ show: (message: string, opts?: { tone?: 'ok' | 'bad' }) => void };

/** Copy text to the clipboard and toast the result. */
export async function copyText(text: string, toast: Toast, okMsg = 'Copied'): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    toast.show(okMsg, { tone: 'ok' });
    return true;
  } catch {
    toast.show('Copy failed: press and hold the text to copy it', { tone: 'bad' });
    return false;
  }
}

/**
 * Open the iOS share sheet with `message`. Where sharing is not available (most desktop
 * browsers in the web preview) the text is copied instead.
 */
export async function shareText(message: string, toast: Toast, title?: string): Promise<void> {
  try {
    await Share.share(Platform.OS === 'ios' ? { message } : { message, title });
  } catch (e) {
    // Dismissing the sheet is not an error; "not supported" (web) falls back to copying.
    const msg = e instanceof Error ? e.message : '';
    if (/abort|cancel/i.test(msg)) return;
    await copyText(message, toast, 'Sharing is not available here, so it was copied instead');
  }
}

/** Accounts anonymized by POST /api/account/delete keep their row under this address. */
export const isDeletedEmail = (email: string | null | undefined): boolean => /^deleted-\d+@invalid$/.test(email || '');
