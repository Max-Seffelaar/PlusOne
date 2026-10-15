import type { CSSProperties } from 'react';

/**
 * Padding for a standalone full-screen route (onboarding, consent, login, MFA,
 * the door picker, not-found) that keeps its content out of the system bars.
 *
 * The root layout sets `viewportFit: 'cover'`, so on a phone the page draws
 * under the status bar, the notch and the Android navigation bar. The insets
 * come from the `--safe-*` tokens in globals.css (Capacitor's injected
 * `--safe-area-inset-*` on Android, `env()` on iOS, 0 on a desktop), never
 * from a raw `env()` — so adding them is always correct, never double.
 *
 * The `/app` shell has its own (`ROOT_SAFE_AREA` + the bottom bars in
 * shell.tsx); this is for every route that renders outside it. Each value is
 * the screen's own padding plus the inset, as an inline style, so it replaces
 * the Tailwind padding class it stands for — drop that class at the call site.
 */
export function safeAreaPadding(
  top: number,
  right: number = top,
  bottom: number = top,
  left: number = right,
): CSSProperties {
  return {
    paddingTop: `calc(${top}px + var(--safe-top))`,
    paddingRight: `calc(${right}px + var(--safe-right))`,
    paddingBottom: `calc(${bottom}px + var(--safe-bottom))`,
    paddingLeft: `calc(${left}px + var(--safe-left))`,
  };
}
