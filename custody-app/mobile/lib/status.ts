import type { Tone } from './theme';

/**
 * Status label and tone, identical to STATUS in custody-app/public/app.js so both clients
 * use the same words for rules, events, expenses and payments.
 */
export const STATUS: Record<string, readonly [label: string, tone: Tone]> = {
  active: ['Approved', 'ok'],
  unconfirmed: ['Not yet confirmed', 'warn'],
  pending: ['Awaiting approval', 'warn'],
  rejected: ['Rejected', 'bad'],
  withdrawn: ['Withdrawn', 'neutral'],
  retired: ['Ended', 'neutral'],
  proposed: ['Needs acknowledgement', 'warn'],
  accepted: ['Acknowledged', 'ok'],
  declined: ['Declined', 'bad'],
  cancelled: ['Cancelled', 'neutral'],
  logged: ['Record only', 'neutral'],
  requested: ['Reimbursement requested', 'warn'],
  approved: ['Approved, unpaid', 'ok'],
  disputed: ['Disputed', 'bad'],
  reimbursed: ['Reimbursed', 'ok'],
  sent: ['Sent, awaiting confirmation', 'warn'],
  confirmed: ['Received', 'ok'],
};

export function statusLabel(status: string): string {
  return STATUS[status]?.[0] ?? status;
}

export function statusTone(status: string): Tone {
  return STATUS[status]?.[1] ?? 'neutral';
}

/** Call log outcomes, same labels as the web portal's CALL_STATUS. */
export const CALL_STATUS: readonly (readonly [value: string, label: string])[] = [
  ['completed', 'Completed'],
  ['short', 'Cut short'],
  ['missed_not_facilitated', 'Missed: child not made available'],
  ['missed_not_called', 'Missed: parent did not call'],
  ['declined_by_child', 'Child declined'],
  ['rescheduled', 'Rescheduled by agreement'],
  ['cancelled', 'Cancelled by agreement'],
];

/** Exchange check-in kinds, same labels as the web portal. */
export const EXCHANGE_KIND: Record<string, string> = {
  dropoff: 'Drop-off',
  pickup: 'Pick-up',
  no_show_other: 'Other parent no-show',
  late_other: 'Other parent late',
};
