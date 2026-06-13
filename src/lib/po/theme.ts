/**
 * Raw token values for the few cases Tailwind utility classes can't express:
 * dynamic colors (tier dots, progress fills), SVG strokes, and gradients.
 *
 * Everywhere else, prefer the Tailwind tokens already defined in
 * `tailwind.config.ts` (bg / elev / line / acc / …). This object is the escape
 * hatch, not the default. Keys mirror the design-system token names.
 */
export const P = {
  bg: '#0B0B0D',
  elev: '#161618',
  elev2: '#1E1E21',
  line: 'rgba(255,255,255,0.10)',
  line2: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF',
  dim: 'rgba(255,255,255,0.58)',
  faint: 'rgba(255,255,255,0.40)',
  ghost: 'rgba(255,255,255,0.26)',
  acc: '#B5A6FF',
  accSoft: '#C9BEFF',
  accDim: 'rgba(181,166,255,0.16)',
  onAcc: '#16132B',
} as const;

/** Soft top-lit lavender wash used on the welcome / auth frames. */
export const AUTH_GRADIENT = `radial-gradient(120% 80% at 50% 0%, #1a1830 0%, ${P.bg} 55%)`;

/** Warm paper "stage" the phone sits on (desktop preview only). */
export const STAGE_GRADIENT =
  'radial-gradient(140% 100% at 80% -10%, #f2efe8 0%, #e7e2d8 50%, #ddd7cb 100%)';
