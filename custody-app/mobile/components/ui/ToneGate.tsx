import { useCallback } from 'react';
import { View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import type { ToneResult } from '@/lib/types';
import { AppText } from './AppText';
import { useDialog } from './Dialog';
import { useToast } from './Toast';

/**
 * Tone check before sending a message (POST /api/tone-check). Resolves true to send.
 * If issues are found, shows them with "Edit message" / "Send anyway"; it never blocks.
 *
 *   const toneGate = useToneGate();
 *   if (await toneGate(text)) await api.post(`/api/threads/${id}/messages`, { body: text });
 */
export function useToneGate(): (text: string) => Promise<boolean> {
  const dialog = useDialog();
  const toast = useToast();
  return useCallback(async (text: string) => {
    if (!text.trim()) { toast.show('Write a message'); return false; }
    let r: ToneResult;
    try {
      r = await api.post<ToneResult>('/api/tone-check', { text });
    } catch (e) {
      toast.show(errorMessage(e), { tone: 'bad' });
      return false;
    }
    if (r.ok) return true;
    return dialog.show<boolean>({
      title: 'Before you send',
      message: 'Parts of this message may come across as hostile. A judge, mediator or your children may read it someday.',
      content: (
        <View style={{ marginTop: 12, gap: 10 }}>
          {r.issues.map((i) => (
            <View key={i.id}>
              <AppText weight="600">{i.label}{i.matches?.length ? <AppText tone="muted" weight="400">{` — "${i.matches.join('", "')}"`}</AppText> : null}</AppText>
              <AppText variant="subhead" tone="muted">{i.tip}</AppText>
            </View>
          ))}
        </View>
      ),
      actions: [
        { label: 'Edit message', value: false, variant: 'primary' },
        { label: 'Send anyway', value: true, variant: 'default' },
      ],
      dismissValue: false,
    });
  }, [dialog, toast]);
}
