'use client';

/**
 * Wires the Android hardware back button to the web router inside the native
 * shell (Fase 17 N3, 86ey6bfdm; decision logic in `native-back.ts`). Renders
 * nothing and does nothing in a normal browser: it only registers when
 * `isNativeShell()`, and `@capacitor/app` is imported lazily so the web bundle
 * never loads it.
 *
 * Mounted by the po chrome (`app-chrome.tsx`) and the standalone door layout.
 * It reads the pathname only — no venue-wide query — so mounting it in the
 * chrome adds nothing to the door's ancestor path (86eykm76k). While it is
 * mounted, Capacitor's default back behaviour (webview back, else exit) is
 * off; unmounting removes the listener and restores it.
 */
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isNativeShell } from '@/lib/platform';
import { nativeBackAction } from './native-back';

export function NativeBackButton(): null {
  const pathname = usePathname();
  const router = useRouter();
  // The listener is registered once; it reads the live pathname through a ref.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!isNativeShell()) return;
    let cancelled = false;
    let remove: (() => Promise<void>) | null = null;
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('backButton', ({ canGoBack }) => {
          const online = typeof navigator === 'undefined' || navigator.onLine !== false;
          const action = nativeBackAction(pathRef.current ?? '/', { canGoBack, online });
          if (action.kind === 'none') return;
          if (action.kind === 'minimize') void App.minimizeApp().catch(() => undefined);
          else if (action.kind === 'replace') router.replace(action.to);
          else router.back();
        }),
      )
      .then((handle) => {
        if (cancelled) void handle.remove();
        else remove = () => handle.remove();
      })
      .catch(() => {
        // Plugin missing from an older native build: Capacitor's default back
        // behaviour stays in charge. Nothing to surface to the user.
      });
    return () => {
      cancelled = true;
      if (remove) void remove().catch(() => undefined);
    };
  }, [router]);

  return null;
}
