/**
 * User-agent → device-class heuristic for the viewport switch (launchplan Fase 3).
 *
 * Used server-side (from `headers()`) to pick an initial layout — the `po` mobile
 * app-form below 1024px, the desktop `(app)` shell at/above it — before the client
 * hydrates. This is only a *first-paint hint*: the client corrects it with
 * `matchMedia('(max-width: 1023px)')`, which is the source of truth for the actual
 * breakpoint. Keep this pure (no browser- or Node-only APIs) so it runs unchanged
 * in Server Components, middleware, and a Capacitor webview alike (#37).
 *
 * Caveat: modern iPadOS Safari reports a desktop-class `Macintosh` user-agent, so
 * an iPad in portrait is classified desktop here and only corrected client-side.
 * That is acceptable — the hint just reduces first-paint flicker, it does not gate
 * behaviour.
 */
const MOBILE_UA = /Mobi|Android|iPhone|iPod|iPad|Windows Phone|IEMobile|BlackBerry|Opera Mini|webOS/i;

export function isMobileUA(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return MOBILE_UA.test(ua);
}
