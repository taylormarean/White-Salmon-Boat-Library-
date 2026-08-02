// Design tokens — same system as the Gorge rides fleet frontend, recolored
// for the river (glacial blue-green instead of shuttle orange).

export const C = {
  bg: '#F4F7F7',
  card: 'rgba(255,255,255,0.8)',
  cardSolid: '#FFFFFF',
  border: 'rgba(0,0,0,0.07)',
  divider: 'rgba(0,0,0,0.06)',

  accent: '#0E7C86',
  accentHover: '#0A626A',
  accentTint: 'rgba(14,124,134,0.09)',

  text: '#17282B',
  textSecondary: '#68797C',
  textTertiary: 'rgba(0,0,0,0.35)',
  textOnAccent: '#FFFFFF',

  green: '#2E9E5B',
  greenTint: 'rgba(46,158,91,0.12)',
  yellow: '#E08A00',
  yellowTint: 'rgba(224,138,0,0.12)',
  red: '#D93025',
  redTint: 'rgba(217,48,37,0.1)',
  blue: '#1A73E8',
  blueTint: 'rgba(26,115,232,0.09)',

  navBg: 'rgba(244,247,247,0.9)',
} as const;

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

export const S = {
  page: { fontFamily: FONT, background: C.bg, minHeight: '100vh', color: C.text } as React.CSSProperties,
  card: {
    background: C.cardSolid, border: `1px solid ${C.border}`, borderRadius: 14,
    padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  } as React.CSSProperties,
  h1: { fontSize: 26, fontWeight: 700 as const, letterSpacing: '-0.02em', margin: '0 0 4px' },
  h2: { fontSize: 17, fontWeight: 600 as const, letterSpacing: '-0.01em', margin: '0 0 12px' },
  label: { fontSize: 13, fontWeight: 500 as const, color: C.textSecondary, display: 'block', marginBottom: 4 } as React.CSSProperties,
  input: {
    width: '100%', padding: '10px 12px', fontSize: 15, border: `1px solid ${C.border}`,
    borderRadius: 10, background: '#fff', color: C.text, outline: 'none',
  } as React.CSSProperties,
  btn: {
    padding: '10px 18px', fontSize: 15, fontWeight: 600 as const, border: 'none', borderRadius: 10,
    background: C.accent, color: C.textOnAccent, cursor: 'pointer',
  } as React.CSSProperties,
  btnGhost: {
    padding: '9px 16px', fontSize: 14, fontWeight: 500 as const, border: `1px solid ${C.border}`,
    borderRadius: 10, background: '#fff', color: C.text, cursor: 'pointer',
  } as React.CSSProperties,
  badge: (color: string, tint: string): React.CSSProperties => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12,
    fontWeight: 600, color, background: tint, whiteSpace: 'nowrap',
  }),
  tableWrap: { overflowX: 'auto' } as React.CSSProperties,
  th: {
    textAlign: 'left' as const, fontSize: 12, fontWeight: 600 as const, color: C.textSecondary,
    textTransform: 'uppercase' as const, letterSpacing: '0.05em', padding: '8px 12px',
    borderBottom: `1px solid ${C.divider}`, whiteSpace: 'nowrap' as const,
  },
  td: { padding: '10px 12px', fontSize: 14, borderBottom: `1px solid ${C.divider}`, verticalAlign: 'top' as const },
};
