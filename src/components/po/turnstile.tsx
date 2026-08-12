'use client';

/**
 * Cloudflare Turnstile widget for the public guest-request form (86ey2czr6).
 *
 * Keyless-safe: renders nothing (and never loads the Cloudflare script) when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset, so local dev/CI stay unaffected. The
 * server-side check in submitGuestRequest is the actual security boundary — this
 * widget only supplies the token; a script that fails to load or is blocked
 * fails open here (onToken never fires) and the request either sails through
 * (no TURNSTILE_SECRET_KEY server-side) or is rejected server-side with the
 * same generic error as any other failure (no enumeration).
 */
import { type JSX, useEffect, useId, useRef, useState } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
      remove: (widgetId: string) => void;
    };
  }
}

/** Module-scoped so multiple mounts (unlikely — one form per page) share one
 *  script load instead of racing duplicate <script> tags. */
let scriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      if (window.turnstile) {
        resolve();
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('turnstile script failed to load')));
        return;
      }
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('turnstile script failed to load'));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/** True only when the widget will actually render (site key configured) — the
 *  form uses this to decide whether a token is required before submit. */
export const TURNSTILE_ENABLED = Boolean(SITE_KEY);

export function TurnstileWidget({
  onToken,
}: {
  onToken: (token: string | null) => void;
}): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [scriptReady, setScriptReady] = useState(false);
  const domId = useId();

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (!cancelled) setScriptReady(true);
      })
      .catch(() => {
        // Fails open client-side (see file header); nothing to do here.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!scriptReady || !SITE_KEY || !containerRef.current || !window.turnstile) return;
    const widgetId = window.turnstile.render(containerRef.current, {
      sitekey: SITE_KEY,
      theme: 'dark',
      callback: (token) => onTokenRef.current(token),
      'expired-callback': () => onTokenRef.current(null),
      'error-callback': () => onTokenRef.current(null),
    });
    widgetIdRef.current = widgetId;
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [scriptReady]);

  if (!SITE_KEY) return null;

  return <div ref={containerRef} id={`turnstile-${domId}`} className="mb-[16px] flex justify-center" />;
}
