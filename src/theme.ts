/* Visual direction: plum anime night — a mysterious, tender companion under a violet starry sky,
   with bubblegum-pink accents like the strands of her hair.
   Palette: plum-tinted neutrals, violet/lilac accent, bubblegum pink as the secondary highlight (accentPink).
   Type: system family (Roboto), weights 400/500/700, monospace for MB and token figures.
   Density comfortable, round radius: 16 on cards, buttons and inputs, 24 on bubbles, pills for chips. No illustration in the chrome. */
import { StyleSheet, useColorScheme, Platform } from 'react-native';

const light = {
  bg: '#F6F0FB',
  surface: '#FFFFFF',
  ink: '#231539',
  inkMuted: '#6A5A85',
  line: '#DCCFF0',
  accent: '#7B3FC4',
  accentStrong: '#6A2FB0',
  accentInk: '#FFFFFF',
  accentSoft: '#EADCFA',
  accentPink: '#C23A7E',
  success: '#1F8A55',
  warning: '#A86A00',
  danger: '#C7283F',
};
const dark = {
  bg: '#1B1233',
  surface: '#2A1B4A',
  ink: '#F3EAFB',
  inkMuted: '#B7A6D6',
  line: '#4A3578',
  accent: '#B48CF2',
  accentStrong: '#B48CF2',
  accentInk: '#1B0F33',
  accentSoft: '#3A2468',
  accentPink: '#F25CA8',
  success: '#5BD69A',
  warning: '#F2B84B',
  danger: '#FF7A8A',
};

export const tokens = {
  colors: { light, dark },
  type: {
    xs: { fontSize: 12, lineHeight: 16 },
    sm: { fontSize: 14, lineHeight: 20 },
    md: { fontSize: 16, lineHeight: 24 },
    lg: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
    display: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 40, 8: 48 },
  radius: { card: 16, bubble: 24, pill: 999, input: 16 },
  motion: { fast: 150, base: 250, slow: 400 },
  hit: 44,
  button: 48,
  mono: Platform.select({ android: 'monospace', default: 'Courier' }) as string,
};

export type Colors = typeof light;
export function useColors(): Colors { return useColorScheme() === 'dark' ? dark : light; }

export function makeStyles(c: Colors) {
  const t = tokens;
  const btn = { height: t.button, paddingHorizontal: t.space[4], borderRadius: t.radius.card, alignItems: 'center' as const, justifyContent: 'center' as const, flexDirection: 'row' as const, gap: t.space[2] };
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg, padding: t.space[4] },
    card: { backgroundColor: c.surface, borderRadius: t.radius.card, borderWidth: 1, borderColor: c.line, padding: t.space[4], gap: t.space[2] },
    listRow: { minHeight: t.hit, flexDirection: 'row', alignItems: 'center', gap: t.space[3], paddingVertical: t.space[2] },
    title: { ...t.type.display, color: c.ink },
    heading: { ...t.type.lg, color: c.ink },
    body: { ...t.type.md, color: c.ink },
    muted: { ...t.type.sm, color: c.inkMuted },
    mono: { ...t.type.sm, color: c.ink, fontFamily: t.mono, fontVariant: ['tabular-nums' as const] },
    btnPrimary: { ...btn, backgroundColor: c.accentStrong },
    btnPrimaryText: { ...t.type.md, fontWeight: '700', color: c.accentInk },
    btnPrimaryPressed: { opacity: 0.85 },
    btnSecondary: { ...btn, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line },
    btnSecondaryText: { ...t.type.md, fontWeight: '500', color: c.ink },
    btnTertiary: { ...btn, backgroundColor: 'transparent' },
    btnTertiaryText: { ...t.type.md, fontWeight: '500', color: c.accentStrong },
    btnDanger: { ...btn, backgroundColor: c.danger },
    btnDangerText: { ...t.type.md, fontWeight: '700', color: '#FFFFFF' },
    btnPressed: { opacity: 0.8 },
    btnDisabled: { opacity: 0.4 },
    iconBtn: { width: t.hit, height: t.hit, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center' },
    input: { minHeight: t.hit, borderRadius: t.radius.input, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, color: c.ink, paddingHorizontal: t.space[3], ...t.type.md },
    inputError: { borderColor: c.danger },
    chip: { height: 32, paddingHorizontal: t.space[3], borderRadius: t.radius.pill, backgroundColor: c.accentSoft, justifyContent: 'center' },
    chipText: { ...t.type.xs, fontWeight: '700', color: c.accentStrong },
    tabItem: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 },
    tabItemActive: { borderTopWidth: 2, borderTopColor: c.accent },
    tabLabel: { ...t.type.xs, color: c.inkMuted },
    tabLabelActive: { ...t.type.xs, color: c.accentStrong, fontWeight: '700' },
    tabBar: { flexDirection: 'row', backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.line },
    empty: { alignItems: 'center', justifyContent: 'center', padding: t.space[6], gap: t.space[3] },
    emptyCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
    skeleton: { backgroundColor: c.line, borderRadius: t.radius.card, height: 72 },
    toast: { position: 'absolute', left: t.space[4], right: t.space[4], bottom: t.space[6], backgroundColor: c.ink, borderRadius: t.radius.card, padding: t.space[3] },
    toastText: { ...t.type.sm, color: c.bg },
    bubbleUser: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: c.accent, borderRadius: t.radius.bubble, padding: t.space[3] },
    bubbleUserText: { ...t.type.md, color: c.accentInk },
    bubbleBot: { alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: t.radius.bubble, padding: t.space[3] },
    bubbleBotText: { ...t.type.md, color: c.ink },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: c.line, overflow: 'hidden' },
    progressFill: { height: 8, backgroundColor: c.accentPink },
    warnBox: { backgroundColor: c.surface, borderLeftWidth: 4, borderLeftColor: c.warning, borderRadius: t.radius.card, padding: t.space[3] },
  });
}
