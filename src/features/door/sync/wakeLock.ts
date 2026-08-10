/**
 * Screen Wake Lock API wrapper (86ey6x56p): keeps the door device's screen
 * awake for the length of a check-in session so a locked screen never turns a
 * real arrival into a missed scan.
 *
 * Feature-detected and try/catch-guarded end to end — the API is unsupported
 * in most Capacitor webviews and several mobile browsers (checklist #37), and
 * even where it exists the browser can refuse a request at will (document not
 * visible/focused yet, low-battery policy, no prior user gesture). None of
 * that may ever throw into the door surface (C13, mirrors the localStorage
 * guard in offline/device.ts).
 */

/**
 * Minimal shape of the Wake Lock API. Not a global augmentation: DOM lib
 * support for it varies by TypeScript/toolchain version, and the API itself is
 * routinely absent (Capacitor webviews, older browsers) — treating it as
 * "maybe there" at the value level, not the type level, keeps every call site
 * honest about that.
 */
export interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
  removeEventListener: (type: 'release', listener: () => void) => void;
}

interface NavigatorWithWakeLock {
  wakeLock: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

function wakeLockApi(): NavigatorWithWakeLock['wakeLock'] | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as Partial<NavigatorWithWakeLock>;
  return typeof nav.wakeLock?.request === 'function' ? nav.wakeLock : null;
}

export function isWakeLockSupported(): boolean {
  return wakeLockApi() != null;
}

/**
 * Request a screen wake lock. Resolves to `null` — never throws — when the API
 * is unsupported OR the browser refuses the request (e.g. `NotAllowedError`
 * because the document isn't currently visible).
 */
export async function requestScreenWakeLock(): Promise<WakeLockSentinelLike | null> {
  const api = wakeLockApi();
  if (!api) return null;
  try {
    return await api.request('screen');
  } catch {
    return null;
  }
}

/** Release a sentinel, swallowing any error (already released, webview quirk). */
export async function releaseWakeLock(sentinel: WakeLockSentinelLike | null): Promise<void> {
  if (!sentinel || sentinel.released) return;
  try {
    await sentinel.release();
  } catch {
    // Nothing to do — already released or the platform refused the release call.
  }
}
