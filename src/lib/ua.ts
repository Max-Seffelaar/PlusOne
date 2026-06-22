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

/**
 * Best-effort, human-readable device label from a User-Agent — "Chrome · Windows",
 * "Safari · iPhone", … — for the active-sessions list (S7). Browser AND OS are
 * shown so two sessions on the same browser are still distinguishable. Pure (no
 * browser/Node APIs) so it runs in Server Components, the browser and a Capacitor
 * webview alike (#37).
 *
 * NB: a session created server-side (e.g. the local dev-login route) records the
 * server's UA, which has no OS token — the label then degrades to just "Browser".
 * Real browser logins always carry an OS token, so the production label is full.
 */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return 'Onbekend apparaat';
  const s = ua.toLowerCase();
  const browser =
    s.includes('edg') ? 'Edge'
    : s.includes('firefox') || s.includes('fxios') ? 'Firefox'
    : s.includes('chrome') || s.includes('crios') ? 'Chrome'
    : s.includes('safari') ? 'Safari'
    : 'Browser';
  const os =
    s.includes('iphone') ? 'iPhone'
    : s.includes('ipad') ? 'iPad'
    : s.includes('android') ? 'Android'
    : s.includes('cros') ? 'ChromeOS'
    : s.includes('mac os') || s.includes('macintosh') ? 'Mac'
    : s.includes('windows') ? 'Windows'
    : s.includes('linux') ? 'Linux'
    : '';
  return os ? `${browser} · ${os}` : browser;
}
