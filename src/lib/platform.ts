// Platform seam for the Capacitor wrap (decision #37) and the store-tax rule
// (#32: NO checkout/portal/pricing UI may be reachable inside the native app —
// Apple IAP). Today the app is a browser PWA, so this always returns false; the
// Phase-3 remote-URL wrap injects window.Capacitor and flips it without a code
// change. Keep every purchase-adjacent affordance behind !isNativeShell().

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/**
 * True when the primary input is a precise pointer (mouse/trackpad). Used to
 * decide whether auto-focusing a text field is helpful (desktop) or harmful
 * (mobile/webview, where focus() pops the on-screen keyboard). Guarded for SSR
 * and webviews without matchMedia (#37): defaults to false — never auto-open a
 * keyboard when unsure.
 */
export function hasFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: fine)').matches;
}
