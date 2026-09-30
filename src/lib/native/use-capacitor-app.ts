'use client';

/**
 * The one lifecycle for an `@capacitor/app` listener (Fase 17). Shared by
 * `NativeBackButton` and `NativeAppLinks` so a fix to the lifecycle (StrictMode
 * double-register, a late handle after unmount) lands in one place.
 *
 * Does nothing in a normal browser: it only runs when `isNativeShell()`, and
 * `@capacitor/app` is imported lazily so the web bundle never loads it. A
 * missing plugin (older native build) is swallowed: the caller's feature is
 * simply absent, nothing to surface.
 *
 * `attach` registers the listener(s) and resolves with the handle to remove on
 * unmount. `isActive()` turns false once the effect is cleaned up, so any work
 * `attach` does after an await can bail out; a handle that resolves after
 * unmount is removed immediately.
 */
import { useEffect, type DependencyList } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import type { App as AppPlugin } from '@capacitor/app';
import { isNativeShell } from '@/lib/platform';

export type CapacitorApp = typeof AppPlugin;

export function useCapacitorApp(
  attach: (App: CapacitorApp, isActive: () => boolean) => Promise<PluginListenerHandle>,
  deps: DependencyList,
): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !isNativeShell()) return;
    let active = true;
    let remove: (() => Promise<void>) | null = null;
    void import('@capacitor/app')
      .then(({ App }) => attach(App, () => active))
      .then((handle) => {
        if (!active) void handle.remove().catch(() => undefined);
        else remove = () => handle.remove();
      })
      .catch(() => {
        // Plugin missing from an older native build. Nothing to surface.
      });
    return () => {
      active = false;
      if (remove) void remove().catch(() => undefined);
    };
    // `deps` is the caller's dependency list; `attach` is re-created per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
