import { View } from 'react-native';
import { AppText, Segmented, type Option } from '@/components/ui';

/** Segmented control with a form label (Segmented already carries the field's bottom margin). */
export function SegmentedField<V extends string>({ label, options, value, onChange, testID }: {
  label: string; options: readonly Option<V>[]; value: V; onChange: (v: V) => void; testID?: string;
}) {
  return (
    <View testID={testID}>
      <AppText variant="footnote" tone="muted" weight="500" style={{ marginBottom: 4 }}>{label}</AppText>
      <Segmented options={options} value={value} onChange={onChange} />
    </View>
  );
}
