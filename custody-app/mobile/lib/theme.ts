import { useColorScheme, Platform } from 'react-native';
import { DarkTheme, DefaultTheme, type Theme as NavTheme } from 'expo-router';

/**
 * Colors mirror the web portal's CSS variables (custody-app/public/styles.css) so both
 * clients look like one product. Brand accent: #2f6f9f.
 */
export interface Palette {
  bg: string;
  panel: string;
  ink: string;
  muted: string;
  line: string;
  soft: string;
  accent: string;
  accentInk: string;
  ok: string;
  warn: string;
  bad: string;
  /** tinted backgrounds for badges/callouts (about 15% of the tone) */
  accentSoft: string;
  okSoft: string;
  warnSoft: string;
  badSoft: string;
  /** modal backdrop */
  overlay: string;
  /** color used for "unassigned" / unknown people */
  unassigned: string;
}

export const light: Palette = {
  bg: '#f5f4f0', panel: '#ffffff', ink: '#1d2327', muted: '#5d676e', line: '#dedbd3', soft: '#efede7',
  accent: '#2f6f9f', accentInk: '#ffffff', ok: '#2e7d55', warn: '#a76a00', bad: '#b33a3a',
  accentSoft: 'rgba(47,111,159,0.14)', okSoft: 'rgba(46,125,85,0.14)', warnSoft: 'rgba(167,106,0,0.14)', badSoft: 'rgba(179,58,58,0.13)',
  overlay: 'rgba(0,0,0,0.4)', unassigned: '#9aa4ab',
};

export const dark: Palette = {
  bg: '#15181b', panel: '#1e2226', ink: '#e8eaec', muted: '#9aa4ab', line: '#343a40', soft: '#262b30',
  accent: '#5d9cca', accentInk: '#0d1114', ok: '#5cb88a', warn: '#e0a640', bad: '#e07070',
  accentSoft: 'rgba(93,156,202,0.18)', okSoft: 'rgba(92,184,138,0.16)', warnSoft: 'rgba(224,166,64,0.16)', badSoft: 'rgba(224,112,112,0.16)',
  overlay: 'rgba(0,0,0,0.6)', unassigned: '#6c757d',
};

/** Spacing scale (points). */
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

/** iOS Dynamic Type default sizes (large title 34, title 28, headline 17, body 17, subhead 15, footnote 13, caption 12). */
export const fontSize = { largeTitle: 34, title: 28, title2: 22, title3: 20, headline: 17, body: 17, callout: 16, subhead: 15, footnote: 13, caption: 12 } as const;

/** Minimum touch target (Apple HIG). */
export const TOUCH = 44;

export const fontFamily = Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' });

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

export interface AppTheme {
  dark: boolean;
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
  /** foreground color for a tone */
  tone: (t: Tone) => string;
  /** tinted background for a tone */
  toneSoft: (t: Tone) => string;
}

function build(isDark: boolean): AppTheme {
  const c = isDark ? dark : light;
  return {
    dark: isDark,
    colors: c,
    spacing,
    radius,
    fontSize,
    tone: (t) => (t === 'accent' ? c.accent : t === 'ok' ? c.ok : t === 'warn' ? c.warn : t === 'bad' ? c.bad : c.muted),
    toneSoft: (t) => (t === 'accent' ? c.accentSoft : t === 'ok' ? c.okSoft : t === 'warn' ? c.warnSoft : t === 'bad' ? c.badSoft : c.soft),
  };
}

const LIGHT = build(false);
const DARK = build(true);

/** Current theme, following the system light/dark setting. */
export function useTheme(): AppTheme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

/** React Navigation theme (headers, tab bar, card backgrounds) built from the palette. */
export function navigationTheme(isDark: boolean): NavTheme {
  const base = isDark ? DarkTheme : DefaultTheme;
  const c = isDark ? dark : light;
  return {
    ...base,
    dark: isDark,
    colors: { ...base.colors, primary: c.accent, background: c.bg, card: c.panel, text: c.ink, border: c.line, notification: c.bad },
  };
}
