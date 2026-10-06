'use client';

import { useSyncExternalStore } from 'react';
import { isNativeShell } from './platform';

const subscribe = (): (() => void) => () => {};
const serverSnapshot = (): null => null;

/**
 * `isNativeShell()` for a server-rendered client component (the `/onboarding`
 * wizard SSRs; the `/app` shell does not and can call `isNativeShell()`
 * directly). `null` = not known yet — the server render and the hydration pass,
 * where `window.Capacitor` cannot be read without a mismatch. A caller that
 * would show a purchase-adjacent screen renders a neutral placeholder on
 * `null`, so the native shell never paints one, not even for a frame.
 */
export function useIsNativeShell(): boolean | null {
  return useSyncExternalStore(subscribe, isNativeShell, serverSnapshot);
}
