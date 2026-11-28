import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme, type Tone } from '@/lib/theme';

export type TextVariant = 'largeTitle' | 'title' | 'title2' | 'title3' | 'headline' | 'body' | 'callout' | 'subhead' | 'footnote' | 'caption';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  /** 'ink' (default), 'muted', or a status tone */
  tone?: 'ink' | 'muted' | Tone;
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
}

const WEIGHT: Partial<Record<TextVariant, TextStyle['fontWeight']>> = {
  largeTitle: '700', title: '700', title2: '700', title3: '600', headline: '600',
};

/** Themed text using the iOS type scale. */
export function AppText({ variant = 'body', tone = 'ink', weight, align, style, ...rest }: AppTextProps) {
  const t = useTheme();
  const size = t.fontSize[variant];
  const color = tone === 'ink' ? t.colors.ink : tone === 'muted' ? t.colors.muted : t.tone(tone);
  return (
    <Text
      {...rest}
      style={[{ fontSize: size, lineHeight: Math.round(size * 1.3), color, fontWeight: weight ?? WEIGHT[variant] ?? '400', textAlign: align }, style]}
    />
  );
}
