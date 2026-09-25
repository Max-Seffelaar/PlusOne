/**
 * Android hardware back button in the native shell (Fase 17 N3, 86ey6bfdm).
 *
 * Pure decision logic, kept apart from the listener so it is unit-testable:
 * given the current pathname and whether the webview has history to go back
 * to, what should back do?
 *
 * - `/app` root (G1: Start) → minimize. Never exit and never "back" past the
 *   root into /login or a previous session's page.
 * - Any other `/app/*` URL → history back. Every screen, tab and door overlay
 *   is a real URL (G1, `routes.ts`), so the browser history IS the nav stack.
 *   With no history (cold start on a deep link) → replace to the `/app` root,
 *   so back never dead-ends.
 * - Standalone door: `/door/<eventId>` → the `/door` picker (replace, not
 *   history: the picker is the door's logical parent whatever came before);
 *   the picker itself → minimize. OFFLINE, back on `/door/<eventId>` does
 *   nothing: the picker is a server-rendered, session-cached page, and leaving
 *   a door that works offline for one that may not load would strand the
 *   doorhost mid-shift (#25). Minimizing would be harmless but surprising; a
 *   no-op keeps them exactly where the outbox is.
 * - Anything else (only reachable if a caller mounts the listener elsewhere):
 *   history back when possible, else minimize.
 */
export type NativeBackAction =
  | { kind: 'history-back' }
  | { kind: 'replace'; to: string }
  | { kind: 'minimize' }
  | { kind: 'none' };

export interface NativeBackContext {
  /** Capacitor's `backButton` event: the webview has history to go back to. */
  canGoBack: boolean;
  /** `navigator.onLine` at the moment back was pressed. */
  online: boolean;
}

function normalize(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return trimmed || '/';
}

export function nativeBackAction(pathname: string, { canGoBack, online }: NativeBackContext): NativeBackAction {
  const path = normalize(pathname);
  if (path === '/app' || path === '/door') return { kind: 'minimize' };
  if (path.startsWith('/door/')) return online ? { kind: 'replace', to: '/door' } : { kind: 'none' };
  if (path.startsWith('/app/')) return canGoBack ? { kind: 'history-back' } : { kind: 'replace', to: '/app' };
  return canGoBack ? { kind: 'history-back' } : { kind: 'minimize' };
}
