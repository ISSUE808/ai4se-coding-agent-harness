/**
 * CodeHarness WebUI — design tokens
 * -------------------------------------------------------------------------
 * Single source of truth for the WebUI. The React client imports this file
 * directly; no component may hard-code a color, font size, or spacing value.
 *
 * Palette: a coordinated dark, low-saturation scheme engineered in OKLch and
 * emitted here as hex for drop-in use. Neutral surfaces are near-zero chroma;
 * chroma is reserved for STATE and the single primary accent only — that is
 * what keeps "machine is deciding" moments unmissable.
 *
 * To add a light theme later: implement the same `ColorTokens` shape and key
 * it under `themes.light` — the structure is already theme-agnostic.
 */

// ─── Raw palette (private — semantic layer below is the real contract) ──────
const palette = {
  // neutrals (cool slate, ~0 chroma → reads as true neutral, not tinted)
  ink0: '#0d1015', // deepest — app background
  ink1: '#12161c', // raised surface (cards, panels)
  ink2: '#171c23', // wells, recessed code areas
  ink3: '#1e242d', // hover fill on rows / subtle fills
  ink4: '#262d38', // active / pressed fill
  line0: '#21272f', // hairline borders
  line1: '#2c333d', // stronger borders, focused inputs
  slate7: '#8a939f', // muted text
  slate5: '#b6bdc7', // secondary text
  slate2: '#e6e9ee', // primary text

  // accent — electric indigo (the ONE accent: interactive / primary / live)
  indigo:       '#7c8cff',
  indigoBright: '#97a5ff',
  indigoDeep:   '#5a6bef',
  indigoInk:    '#0b0e1e',

  // status hues (reserved for state only, never decoration)
  green:  '#3ecf8e',
  red:    '#ff6b6b',
  amber:  '#f5a623',
  blue:   '#59b7ff',
  violet: '#c09bff',
} as const;

// ─── Semantic contract ──────────────────────────────────────────────────────
const colors = {
  // surfaces & structure
  bg:           palette.ink0,
  surface:      palette.ink1,
  surfaceHover: palette.ink3,
  well:         palette.ink2,
  border:       palette.line0,
  borderStrong: palette.line1,

  // text
  text:       palette.slate2,
  textMuted:  palette.slate7,
  textSubtle: palette.slate5,
  textFaint:  palette.slate7, // faintest text — disabled labels, timestamps

  // single primary accent (interactive, links, live/running indicator)
  primary:       palette.indigo,
  primaryHover:  palette.indigoBright,
  primaryActive: palette.indigoDeep,
  onPrimary:     palette.indigoInk,
  primarySoft:   'rgba(124, 140, 255, 0.14)',
  primaryBorder: 'rgba(124, 140, 255, 0.45)',

  // status — success / danger / warning / info, each with a soft tint + border
  success:       palette.green,
  successSoft:   'rgba(62, 207, 142, 0.14)',
  successBorder: 'rgba(62, 207, 142, 0.45)',
  onSuccess:     '#04140c',

  danger:       palette.red,
  dangerHover:  '#ff8585',
  dangerSoft:   'rgba(255, 107, 107, 0.14)',
  dangerBorder: 'rgba(255, 107, 107, 0.45)',
  onDanger:     '#1a0606',

  warning:       palette.amber,
  warningSoft:   'rgba(245, 166, 35, 0.14)',
  warningBorder: 'rgba(245, 166, 35, 0.45)',
  onWarning:     '#171002',

  info:       palette.blue,
  infoSoft:   'rgba(89, 183, 255, 0.14)',
  infoBorder: 'rgba(89, 183, 255, 0.45)',
  onInfo:     '#041018',

  // agent-message role accents (center feed identity)
  roleUser:      palette.indigo,
  roleAssistant: palette.slate5,
  roleTool:      palette.violet,
  roleFeedback:  palette.green,
  roleSystem:    palette.slate7,

  // code / diff (Monaco wells)
  codeBg:     palette.ink2,
  codeText:   '#d7dce3',
  diffAddBg:  'rgba(62, 207, 142, 0.13)',
  diffAddText:'#7ee2ae',
  diffDelBg:  'rgba(255, 107, 107, 0.12)',
  diffDelText:'#ff9d9d',

  // session lifecycle status (dashboard badges + detail header)
  statusRunning:   palette.green,
  statusPaused:    palette.amber,
  statusCompleted: palette.blue,
  statusFailed:    palette.red,

  // overlays / scrims
  overlay:  'rgba(6, 8, 12, 0.64)',
  focusRing:'rgba(124, 140, 255, 0.35)',
} as const;

// ─── Spacing — 4pt scale ────────────────────────────────────────────────────
const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const;

// ─── Typography — sans UI + mono code/numeric ───────────────────────────────
const typography = {
  fontFamily: {
    sans: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  },
  // UI sizes
  fontSize: {
    xs:   '11px',
    sm:   '12px',
    base: '13px',
    md:   '14px',
    lg:   '16px',
    xl:   '20px',
    '2xl':'24px',
  },
  // code / ID / token-count sizes (mono pair)
  codeSize: {
    sm: '11px',
    md: '12px',
  },
  fontWeight: {
    regular: 400,
    medium:  500,
    semibold:600,
  },
  lineHeight: {
    tight:  1.25,
    normal: 1.5,
    relaxed:1.6,
  },
} as const;

// ─── Radius ─────────────────────────────────────────────────────────────────
const radius = {
  sm:   '6px',
  md:   '8px',
  lg:   '12px',
  pill: '999px',
} as const;

// ─── Shadows (dark theme: soft, low, used sparingly for elevation) ─────────
const shadows = {
  sm:      '0 1px 2px rgba(0, 0, 0, 0.4)',
  md:      '0 4px 16px rgba(0, 0, 0, 0.45)',
  lg:      '0 12px 40px rgba(0, 0, 0, 0.55)',
  primary: '0 4px 14px rgba(90, 107, 239, 0.35)',
} as const;

export const designTokens = {
  colors,
  spacing,
  typography,
  radius,
  shadows,
} as const;

export type DesignTokens = typeof designTokens;
export default designTokens;
