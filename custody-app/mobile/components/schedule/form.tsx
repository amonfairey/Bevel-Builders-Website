import { useCallback, useState } from 'react';
import { router, type Href } from 'expo-router';
import { Button, Callout, EmptyState, Screen, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useBadges } from '@/lib/badges';
import { usePeople } from '@/lib/hooks';
import { routes } from '@/lib/links';
import type { IdResponse } from '@/lib/types';

/** Close a schedule form sheet (back to the schedule, which refetches on focus). */
export function closeForm(): void {
  if (router.canGoBack()) router.back();
  else router.replace(routes.schedule as Href);
}

/** Parse a whole number typed into a text field ('' / junk -> null). */
export function toInt(s: string): number | null {
  const v = s.trim();
  return /^-?\d+$/.test(v) ? Number(v) : null;
}

/**
 * POST /api/rules for the form screens: inline + toast error on failure, toast and close
 * on success. The submit label is "Send for approval" once a co-parent has joined.
 */
export function useRuleSubmit() {
  const { other } = usePeople();
  const toast = useToast();
  const badges = useBadges();
  const [error, setError] = useState<string | null>(null);
  const submitLabel = other ? 'Send for approval' : 'Save';

  const submit = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setError(null);
    try {
      await api.post<IdResponse>('/api/rules', body);
      toast.show(other ? 'Sent for approval' : 'Saved', { tone: 'ok' });
      void badges.refresh();
      closeForm();
      return true;
    } catch (e) {
      const m = errorMessage(e);
      setError(m);
      toast.show(m, { tone: 'bad' });
      return false;
    }
  }, [other, toast, badges]);

  /** Show a client-side validation problem the same way as a server error. */
  const fail = useCallback((m: string) => { setError(m); toast.show(m, { tone: 'bad' }); }, [toast]);

  return { submit, error, setError, fail, submitLabel };
}

/** What happens after submitting: approval by the co-parent, or "not yet confirmed" before they join. */
export function ApprovalNotice({ what = 'this' }: { what?: string }) {
  const { other } = usePeople();
  if (!other) {
    return (
      <Callout tone="warn" title="Your co-parent hasn't joined yet">
        {`${what[0].toUpperCase()}${what.slice(1)} takes effect right away, marked "not yet confirmed". Your co-parent confirms or disputes it when they join.`}
      </Callout>
    );
  }
  return <Callout tone="accent">{`Nothing changes until ${other.name} approves ${what}. Both of you can see the request and its history.`}</Callout>;
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return <Callout tone="bad" title="Not sent">{error}</Callout>;
}

/** Full-width submit button for the pinned footer. */
export function SubmitButton({ label, onPress, testID = 'schedule-submit' }: { label: string; onPress: () => unknown; testID?: string }) {
  return <Button title={label} variant="primary" block onPress={onPress} testID={testID} />;
}

/** Shown instead of a form to view-only members. */
export function ViewOnlyScreen({ headerTitle }: { headerTitle: string }) {
  return (
    <Screen headerTitle={headerTitle}>
      <EmptyState icon="eye-outline" title="View only" message="View-only members can see the custody schedule but can't request changes." />
    </Screen>
  );
}
