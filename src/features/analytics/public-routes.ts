/**
 * Which routes are "public" for consent purposes (plan §3–4).
 *
 *   banner     `/`, `/login`, `/e/<slug>` — the marketing landing, the pre-auth
 *              login, and the guest request form. The banner is asked there and
 *              nowhere else: never inside `/app`, `/door`, `/onboarding` or any
 *              other signed-in surface (and so never in the native webview, which
 *              also checks `isNativeShell()` on its own).
 *   analytics  `/` and `/login` only. With banner consent these send anonymous
 *              events. The guest form `/e/<slug>` asks the question (future
 *              marketing pixels) but never loads PostHog: guests are never
 *              tracked (decision 4). Bearer pages (`/s/`, `/r/`, `/n/`, `/u/`,
 *              `/i/`) neither ask nor track.
 */
export function isBannerRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === '/' || pathname === '/login' || pathname === '/e' || pathname.startsWith('/e/');
}

export function isPublicAnalyticsRoute(pathname: string | null): boolean {
  return pathname === '/' || pathname === '/login';
}
