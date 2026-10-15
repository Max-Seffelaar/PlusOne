import type { CSSProperties } from 'react';

/**
 * Padding for a standalone full-screen route (onboarding, consent, login, MFA,
 * the door picker, not-found) that keeps its content out of the system bars.
 *
 * The root layout sets `viewportFit: 'cover'`, so on a phone the page draws
 * under the status bar and, on Android 15+ edge-to-edge, under the gesture /
 * 3-button navigation bar. `env(safe-area-inset-*)` is what reserves that room:
 * real values on iOS and on Android WebView ≥ 140 (Capacitor `SystemBars`
 * insetsHandling 'css' keeps the webview edge-to-edge there), 0 on older
 * WebViews, where Capacitor pads the webview natively instead, and 0 in a
 * desktop browser. So adding it is always correct, never double.
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
    paddingTop: `calc(${top}px + env(safe-area-inset-top))`,
    paddingRight: `calc(${right}px + env(safe-area-inset-right))`,
    paddingBottom: `calc(${bottom}px + env(safe-area-inset-bottom))`,
    paddingLeft: `calc(${left}px + env(safe-area-inset-left))`,
  };
}
