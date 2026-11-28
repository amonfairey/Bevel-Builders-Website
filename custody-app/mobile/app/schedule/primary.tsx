import { useState } from 'react';
import { AppText, Screen, Select, TextArea } from '@/components/ui';
import { ApprovalNotice, FormError, SubmitButton, ViewOnlyScreen, useRuleSubmit } from '@/components/schedule/form';
import { usePeople } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

/** Choose the primary (background) parent: who has the children when nothing else applies. */
export default function PrimaryScreen() {
  const t = useTheme();
  const { me, isParent, parentOptions, nameOf } = usePeople();
  const { submit, error, submitLabel } = useRuleSubmit();
  const [parent, setParent] = useState<number>(me.primary ?? me.user.id);
  const [reason, setReason] = useState('');

  if (!isParent) return <ViewOnlyScreen headerTitle="Primary parent" />;

  const send = () => submit({ type: 'default', name: 'Primary custodial parent', config: { parent }, reason: reason.trim() });

  return (
    <Screen headerTitle="Primary parent" footer={<SubmitButton label={submitLabel} onPress={send} />} testID="schedule-primary-screen">
      <ApprovalNotice what="this change" />
      <AppText variant="subhead" tone="muted" style={{ marginBottom: t.spacing.lg }}>
        The primary parent has the children whenever no regular schedule, holiday or one-time change applies. Once approved, it replaces the current primary parent.
      </AppText>
      <Select
        label="Primary parent"
        value={parent}
        options={parentOptions}
        onChange={setParent}
        hint={me.primary ? `Currently ${nameOf(me.primary)}.` : 'No primary parent is set yet.'}
        testID="primary-parent"
      />
      <TextArea label="Reason" value={reason} onChangeText={setReason} placeholder="e.g. Per custody order dated…" testID="primary-reason" />
      <FormError error={error} />
    </Screen>
  );
}
