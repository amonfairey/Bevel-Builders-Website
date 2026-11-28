import { useCallback } from 'react';
import { useAttempt, useDialog } from '@/components/ui';
import { api } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { money } from '@/lib/format';
import type { Expense, OkResponse, Payment } from '@/lib/types';

/**
 * Approve / dispute / request-reimbursement for expenses and confirm / not-received for
 * payments, with the same dialogs and wording as the web portal. Each resolves true when
 * the server accepted the change; `onDone` runs after every successful change.
 */
export function useMoneyActions(onDone?: () => unknown) {
  const dialog = useDialog();
  const attempt = useAttempt();
  const badges = useBadges();

  const after = useCallback(async (ok: unknown) => {
    if (ok === undefined) return false;
    void badges.refresh();
    await onDone?.();
    return true;
  }, [badges, onDone]);

  const approve = useCallback(async (e: Expense) => {
    const c = await dialog.confirm({ title: 'Approve reimbursement', message: `You agree to pay ${money(e.owed_cents)} for "${e.description}".`, okLabel: 'Approve', withNote: true });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/expenses/${e.id}/decide`, { decision: 'approve', note: c.note }), 'Approved'));
  }, [dialog, attempt, after]);

  const dispute = useCallback(async (e: Expense) => {
    const c = await dialog.confirm({
      title: 'Dispute expense', message: 'Explain specifically what you disagree with (amount, necessity, prior agreement).',
      okLabel: 'Dispute', destructive: true, withNote: true, noteRequired: true, notePlaceholder: 'Required: why you disagree',
    });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/expenses/${e.id}/decide`, { decision: 'dispute', note: c.note }), 'Disputed'));
  }, [dialog, attempt, after]);

  const request = useCallback(async (e: Expense, coName: string) => {
    const c = await dialog.confirm({ title: 'Request reimbursement?', message: `${coName} will be asked to approve ${money(e.owed_cents)} for "${e.description}".`, okLabel: 'Request' });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/expenses/${e.id}/request`), 'Requested'));
  }, [dialog, attempt, after]);

  const confirmReceived = useCallback(async (p: Payment, fromName: string) => {
    const c = await dialog.confirm({ title: 'Payment received?', message: `You confirm you received ${money(p.amount_cents)} from ${fromName}. Linked approved expenses are marked reimbursed.`, okLabel: 'Yes, received' });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/payments/${p.id}/confirm`, { received: true }), 'Confirmed'));
  }, [dialog, attempt, after]);

  const notReceived = useCallback(async (p: Payment) => {
    const c = await dialog.confirm({
      title: 'Not received?', message: 'This is recorded as disputed and the sender is notified.', okLabel: 'Not received', destructive: true,
      withNote: true, notePlaceholder: 'What happened? (optional, saved to the record)',
    });
    if (!c) return false;
    return after(await attempt(() => api.post<OkResponse>(`/api/payments/${p.id}/confirm`, { received: false, note: c.note }), 'Recorded as not received'));
  }, [dialog, attempt, after]);

  return { approve, dispute, request, confirmReceived, notReceived };
}
