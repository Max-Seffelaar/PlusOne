/**
 * The only module that touches posthog-js — and only through a dynamic
 * `import()`, never a static one (door first paint, plan §1 and "Risks": a
 * user without consent or without a configured key never downloads the
 * bundle). `posthog-confinement.test.ts` fails on any other import of it.
 */
import type { PostHog } from 'posthog-js';
import { POSTHOG_KEY, posthogConfig } from './config';

let loading: Promise<PostHog> | null = null;
let ready: PostHog | null = null;

/** Load and init posthog-js once per page. Rejects when the chunk cannot load (offline). */
export function loadPostHog(): Promise<PostHog> {
  if (!loading) {
    loading = import('posthog-js')
      .then(({ default: posthog }) => {
        posthog.init(POSTHOG_KEY, {
          ...posthogConfig(),
          loaded: (ph) => {
            if (process.env.NODE_ENV !== 'production') ph.debug(true);
          },
        });
        ready = posthog;
        return posthog;
      })
      .catch((e: unknown) => {
        loading = null; // a later enable() may retry once the network is back
        throw e;
      });
  }
  return loading;
}

/** The initialised instance, or null when it was never loaded on this page. */
export function loadedPostHog(): PostHog | null {
  return ready;
}

/**
 * Remove everything posthog-js keeps on this device for our project: its
 * distinct id / super properties (`ph_<key>_posthog`) and its opt-in/out marker.
 * Works without posthog-js loaded, so a sign-out on a page that never enabled
 * analytics still leaves nothing behind.
 */
export function clearPostHogStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const ls = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k) continue;
      if ((k.startsWith('ph_') && POSTHOG_KEY && k.includes(POSTHOG_KEY)) || k.startsWith('__ph_opt_in_out_')) {
        doomed.push(k);
      }
    }
    for (const k of doomed) ls.removeItem(k);
  } catch {
    // storage disabled: nothing was stored either
  }
}
