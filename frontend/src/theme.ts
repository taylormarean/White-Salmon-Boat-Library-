// Design tokens — full parity with the Gorge rides fleet frontend design system
// (Apple-inspired: frosted glass, layered shadows, tight letter-spacing),
// recolored for the river: glacial teal instead of shuttle orange.

// --- Colors ---
export const C = {
  // Base
  bg: '#F4F7F7',
  card: 'rgba(255,255,255,0.72)',
  cardSolid: '#FFFFFF',
  cardHover: 'rgba(255,255,255,0.85)',
  border: 'rgba(0,0,0,0.06)',
  borderHover: 'rgba(0,0,0,0.1)',
  divider: 'rgba(0,0,0,0.06)',

  // Brand — glacial teal
  accent: '#0E7C86',
  accentHover: '#0A626A',
  accentTint: 'rgba(14,124,134,0.09)',
  accentTintHover: 'rgba(14,124,134,0.15)',

  // Text
  text: '#17282B',
  textSecondary: '#68797C',
  textTertiary: 'rgba(0,0,0,0.35)',
  textOnAccent: '#FFFFFF',

  // Status
  green: '#2E9E5B',
  greenTint: 'rgba(46,158,91,0.12)',
  yellow: '#E08A00',
  yellowTint: 'rgba(224,138,0,0.12)',
  red: '#D93025',
  redTint: 'rgba(217,48,37,0.1)',
  blue: '#1A73E8',
  blueTint: 'rgba(26,115,232,0.09)',

  // Nav
  navBg: 'rgba(244,247,247,0.78)',
  navBorder: 'rgba(0,0,0,0.08)',
  navText: '#68797C',
  navActive: '#0E7C86',
  navActiveBg: 'rgba(14,124,134,0.09)',
} as const;

// --- Typography ---
export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

export const T = {
  hero:      { fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', color: C.text } as const,
  title:     { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: C.text } as const,
  heading:   { fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: C.text } as const,
  body:      { fontSize: 15, fontWeight: 400, letterSpacing: '-0.01em', color: C.text } as const,
  secondary: { fontSize: 15, fontWeight: 400, letterSpacing: '-0.01em', color: C.textSecondary } as const,
  label:     { fontSize: 13, fontWeight: 500, letterSpacing: '-0.01em', color: C.textSecondary } as const,
  caption:   { fontSize: 12, fontWeight: 500, letterSpacing: '0em', color: C.textTertiary } as const,
  smallCaps: { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: C.textTertiary },
} as const;

// --- Radius ---
export const R = { sm: 8, md: 12, lg: 16, xl: 20, pill: 100 } as const;

// --- Shadows ---
export const SHADOW = {
  card: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)',
  elevated: '0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.06)',
  modal: '0 8px 24px rgba(0,0,0,0.12), 0 24px 64px rgba(0,0,0,0.16)',
  subtle: '0 1px 2px rgba(0,0,0,0.04)',
  focus: '0 0 0 4px rgba(14,124,134,0.12)',
} as const;

// --- Glass surface ---
export const GLASS = {
  background: C.card,
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  border: `1px solid ${C.border}`,
  borderRadius: R.lg,
  boxShadow: SHADOW.card,
} as const;

// --- Reusable style objects (S keeps the shorthand names the pages use) ---
export const S = {
  page: {
    fontFamily: FONT, minHeight: '100vh', color: C.text,
    background: `radial-gradient(1200px 400px at 50% -100px, rgba(14,124,134,0.07), transparent), ${C.bg}`,
  } as React.CSSProperties,

  card: { ...GLASS, padding: 22 } as React.CSSProperties,

  h1: { ...T.hero, margin: '0 0 4px' } as React.CSSProperties,
  h2: { ...T.heading, margin: '0 0 14px' } as React.CSSProperties,

  label: { ...T.label, display: 'block', marginBottom: 6 } as React.CSSProperties,

  input: {
    display: 'block', width: '100%', padding: '11px 14px', boxSizing: 'border-box' as const,
    borderRadius: R.sm, border: `1px solid ${C.border}`,
    background: 'rgba(255,255,255,0.65)', color: C.text,
    fontSize: 15, fontFamily: FONT, outline: 'none',
  } as React.CSSProperties,

  btn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '10px 20px', borderRadius: R.md, border: 'none',
    background: C.accent, color: C.textOnAccent,
    fontSize: 15, fontWeight: 600, fontFamily: FONT, letterSpacing: '-0.01em',
    cursor: 'pointer',
  } as React.CSSProperties,

  btnGhost: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '9px 18px', borderRadius: R.md,
    border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.55)',
    color: C.text, fontSize: 14, fontWeight: 500, fontFamily: FONT, letterSpacing: '-0.01em',
    cursor: 'pointer',
  } as React.CSSProperties,

  badge: (color: string, tint: string): React.CSSProperties => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: R.pill, fontSize: 12,
    fontWeight: 600, color, background: tint, whiteSpace: 'nowrap', letterSpacing: '-0.01em',
  }),

  tableWrap: { overflowX: 'auto' } as React.CSSProperties,

  th: {
    ...T.smallCaps, textAlign: 'left' as const, padding: '10px 14px',
    borderBottom: `1px solid ${C.divider}`, background: 'rgba(0,0,0,0.02)',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  td: {
    padding: '12px 14px', fontSize: 14, color: C.text,
    borderBottom: `1px solid ${C.divider}`, verticalAlign: 'top' as const,
  } as React.CSSProperties,
};

// --- Global CSS injection (animations, focus rings, hover states, scrollbar) ---
// Same technique as the fleet app: inline styles can't express :hover/:focus,
// so the interactive layer lives in one injected stylesheet.
let injected = false;
export function injectGlobalStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = `
    * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
    body { margin: 0; background: ${C.bg}; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes menuSlide { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes modalIn { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes popIn { 0% { opacity: 0; transform: scale(0.9); } 60% { transform: scale(1.03); } 100% { opacity: 1; transform: scale(1); } }
    @keyframes spin { to { transform: rotate(360deg); } }
    .page-enter { animation: fadeIn 0.35s cubic-bezier(0.25,0.46,0.45,0.94); }
    .menu-enter { animation: menuSlide 0.25s cubic-bezier(0.25,0.46,0.45,0.94); }
    .modal-overlay { animation: overlayIn 0.2s ease; }
    .modal-card { animation: modalIn 0.28s cubic-bezier(0.25,0.46,0.45,0.94); }
    .pop-in { animation: popIn 0.45s cubic-bezier(0.25,0.46,0.45,0.94); }
    .spin { animation: spin 0.8s linear infinite; }
    input, select, textarea { transition: border-color 0.2s ease, box-shadow 0.2s ease; font-family: ${FONT}; }
    input:focus, select:focus, textarea:focus { border-color: ${C.accent} !important; box-shadow: ${SHADOW.focus} !important; outline: none !important; }
    button { transition: transform 0.15s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.15s ease, background 0.15s ease, opacity 0.15s ease, border-color 0.15s ease; }
    button:not(:disabled):hover { transform: translateY(-1px); box-shadow: ${SHADOW.subtle}; }
    button:not(:disabled):active { transform: translateY(0) scale(0.98); box-shadow: none; }
    button:disabled { cursor: not-allowed; }
    tbody tr { transition: background 0.12s ease; }
    tbody tr:hover { background: rgba(14,124,134,0.03); }
    a { color: ${C.accent}; }
    ::selection { background: rgba(14,124,134,0.15); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
  `;
  document.head.appendChild(s);
}
