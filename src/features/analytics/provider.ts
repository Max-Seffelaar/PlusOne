/**
 * Analytics adapter (PostHog, docs/posthog-implementation-plan.md §1). Same
 * shape as the notifications seam (src/features/notifications/provider.ts):
 * callers talk to the `analytics` singleton and never import posthog-js.
 *
 * Not a React provider on purpose: the door's non-React code (DoorProvider
 * callbacks) must be able to capture, and `/door/<id>` shares no React tree
 * with `/app`.
 *
 * States, per page load:
 *
 *   idle      nothing decided yet. Captures are held in a small in-memory queue
 *             (never storage, never the network) so the first `screen_viewed`
 *             of a page is not lost while the gate is still deciding.
 *   starting  consent/identity known, posthog-js loading.
 *   on        sending.
 *   off       not sending: no key, no consent, opted out, or the bundle could
 *             not load. The queue is dropped.
 *
 * Without `NEXT_PUBLIC_POSTHOG_KEY` every method is a no-op from the first
 * call: nothing is queued, nothing loads, nothing is stored.
 */
import { analyticsConfigured } from './config';
import { denyAnalytics } from './consent';
import type { AnalyticsEvent, AppSurface } from './events';
import { toCapture } from './events';
import { clearPostHogStorage, loadPostHog, loadedPostHog } from './posthog-client';

export interface AnalyticsIdentity {
  /** Supabase user UUID — the PostHog distinct id. Never an e-mail. */
  userId: string;
  venueId: string | null;
  roles: string[];
  surface: AppSurface;
}

export type AnalyticsState = 'idle' | 'starting' | 'on' | 'off';

export interface AnalyticsProvider {
  /** Load posthog-js and start sending; with an identity, identify first (before any capture). */
  enable(identity?: AnalyticsIdentity): Promise<void>;
  /** Stop for this page without touching stored choices (no consent / opted out). */
  disable(): void;
  /** Drop queued events without deciding anything (a public page whose visitor said no). */
  discardPending(): void;
  /** Send one catalogued event (queued until the gate decides). */
  capture(event: AnalyticsEvent): void;
  /** The user opted out: stop, forget PostHog's device state, deny the analytics category. */
  optOut(): void;
  /** Sign-out: forget who this device was. */
  reset(): void;
  isEnabled(): boolean;
  state(): AnalyticsState;
}

const QUEUE_MAX = 25;

class PostHogAnalytics implements AnalyticsProvider {
  private st: AnalyticsState = 'idle';
  private queue: AnalyticsEvent[] = [];
  /** Bumped by every enable/disable/reset so a slow load cannot resurrect a newer "off". */
  private gen = 0;

  state(): AnalyticsState {
    return analyticsConfigured() ? this.st : 'off';
  }

  isEnabled(): boolean {
    return this.state() === 'on';
  }

  async enable(identity?: AnalyticsIdentity): Promise<void> {
    if (!analyticsConfigured()) return;
    const gen = ++this.gen;
    this.st = 'starting';
    let ph;
    try {
      ph = await loadPostHog();
    } catch {
      if (gen === this.gen) this.off();
      return;
    }
    if (gen !== this.gen) return; // a disable/reset/newer enable won the race
    try {
      if (ph.has_opted_out_capturing()) ph.opt_in_capturing({ captureEventName: null });
      if (identity) {
        // Identify BEFORE any capture (plan §4). Person props: no name, no e-mail.
        ph.identify(identity.userId, { venue_id: identity.venueId, roles: identity.roles });
        ph.register({ venue_id: identity.venueId, roles: identity.roles, app_surface: identity.surface });
        if (identity.venueId) ph.group('venue', identity.venueId);
      }
    } catch {
      this.off();
      return;
    }
    this.st = 'on';
    const pending = this.queue;
    this.queue = [];
    for (const e of pending) this.send(e);
  }

  disable(): void {
    if (!analyticsConfigured()) return;
    this.gen++;
    this.off();
  }

  discardPending(): void {
    this.queue = [];
  }

  capture(event: AnalyticsEvent): void {
    if (!analyticsConfigured()) return;
    if (this.st === 'on') this.send(event);
    else if (this.st === 'idle' || this.st === 'starting') {
      if (this.queue.length < QUEUE_MAX) this.queue.push(event);
    }
  }

  optOut(): void {
    if (!analyticsConfigured()) return;
    this.disable();
    clearPostHogStorage();
    denyAnalytics();
  }

  reset(): void {
    if (!analyticsConfigured()) return;
    this.gen++;
    this.queue = [];
    try {
      loadedPostHog()?.reset();
    } catch {
      // never block a sign-out on analytics
    }
    clearPostHogStorage();
    this.st = 'idle';
  }

  private off(): void {
    this.st = 'off';
    this.queue = [];
    try {
      // In-memory stop for this page; storage is cleared by optOut/reset where
      // that is the intent. `opt_out_capturing` also persists PostHog's own
      // marker, which enable() lifts again when the gate says yes.
      loadedPostHog()?.opt_out_capturing();
    } catch {
      // nothing loaded, nothing to stop
    }
  }

  private send(event: AnalyticsEvent): void {
    try {
      const { name, props } = toCapture(event);
      loadedPostHog()?.capture(name, props);
    } catch {
      // analytics must never break the app
    }
  }
}

export const analytics: AnalyticsProvider = new PostHogAnalytics();
