/**
 * Category consent manager — the one source of truth for every current and
 * future tracker on this device (docs/posthog-implementation-plan.md §2, plan
 * decision 2). Categories:
 *
 *   necessary  always granted, not a choice (session cookie, door cache, …)
 *   analytics  PostHog on the public marketing pages
 *   marketing  reserved for later pixels (Google / Meta / TikTok); nothing ships
 *              behind it yet, but the banner asks from day one so adding one is
 *              a loader behind `onConsentChange`, not a new banner
 *
 * Persisted in localStorage `plusone.consent.v1` as
 * `{ version, decidedAt, analytics, marketing }`. Bump `CONSENT_VERSION` to
 * re-ask everyone after a material policy change: a stored decision with
 * another version reads as "no decision yet".
 *
 * Scope: this is the PUBLIC (banner) decision. Signed in, the account setting
 * wins (`user_profiles.analytics_opt_out_at`, see AnalyticsGate) — a visitor who
 * declined the banner and then logs in is tracked in the app unless they opted
 * out in Profile, because in-app product analytics is part of the terms
 * (decision 1, disclosed on the consent screen). The banner decision keeps
 * governing the public pages and the marketing category.
 *
 * Webview/SSR-safe (Capacitor #37): every storage touch is guarded and a
 * corrupt, foreign or missing value is "no decision", never a throw.
 */

export const CONSENT_STORAGE_KEY = 'plusone.consent.v1';
export const CONSENT_VERSION = '2026-10-18';

export type ConsentCategory = 'necessary' | 'analytics' | 'marketing';

export interface ConsentDecision {
  version: string;
  /** ISO timestamp of the choice. */
  decidedAt: string;
  analytics: boolean;
  marketing: boolean;
}

type Listener = (decision: ConsentDecision | null) => void;
const listeners = new Set<Listener>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null; // storage disabled (privacy mode, sandboxed webview)
  }
}

function parse(raw: string | null): ConsentDecision | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ConsentDecision> | null;
    if (
      !v ||
      typeof v !== 'object' ||
      v.version !== CONSENT_VERSION ||
      typeof v.decidedAt !== 'string' ||
      typeof v.analytics !== 'boolean' ||
      typeof v.marketing !== 'boolean'
    ) {
      return null;
    }
    return { version: v.version, decidedAt: v.decidedAt, analytics: v.analytics, marketing: v.marketing };
  } catch {
    return null;
  }
}

/** The stored decision, or null when there is none (or it is unreadable/outdated). */
export function readConsent(): ConsentDecision | null {
  const s = storage();
  if (!s) return null;
  try {
    return parse(s.getItem(CONSENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Whether a category is granted. `necessary` always is; the others only after an explicit yes. */
export function hasConsent(category: ConsentCategory): boolean {
  if (category === 'necessary') return true;
  const d = readConsent();
  return d ? d[category] : false;
}

/** Store a choice and tell every subscriber. Returns what was stored. */
export function saveConsent(choice: { analytics: boolean; marketing: boolean }): ConsentDecision {
  const decision: ConsentDecision = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    analytics: choice.analytics,
    marketing: choice.marketing,
  };
  const s = storage();
  try {
    s?.setItem(CONSENT_STORAGE_KEY, JSON.stringify(decision));
  } catch {
    // Quota/disabled storage: the choice still holds for this page load.
  }
  for (const l of [...listeners]) l(decision);
  return decision;
}

/** Withdraw analytics consent only (Profile opt-out), keeping the rest of a stored decision. */
export function denyAnalytics(): void {
  const d = readConsent();
  if (d && !d.analytics) return;
  saveConsent({ analytics: false, marketing: d?.marketing ?? false });
}

/** Subscribe to consent changes (the banner, a later pixel loader). Returns the unsubscribe. */
export function onConsentChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
